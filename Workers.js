// 密码管理系统 - Cloudflare Worker

/**
 * 确保KV和环境变量可用
 * 
 * 使用说明:
 * 1. 在Cloudflare Dashboard创建KV命名空间,名称为"MEMOS"
 * 2. 在Worker配置中绑定此KV命名空间到变量MEMOS_KV
 * 3. 添加环境变量:
 *    - ACCESS_UUID: 访问密钥
 *    - ACCESS_PASSWORD: 管理密码(可选)
 *    - ACCESS_MULTIFACTOR: 多重验证码(可选,设置后启用多重验证)
 */

// KV命名空间，请在Cloudflare Dashboard中绑定
// MEMOS_KV 变量已通过Dashboard绑定到名为"MEMOS"的KV命名空间
// 无需在此手动绑定

// 环境变量，在Cloudflare Dashboard中设置
// const ACCESS_UUID = ACCESS_UUID;
// const ACCESS_PASSWORD = ACCESS_PASSWORD;

// 全局变量与工具函数
let isKvAvailable = false;
const STORAGE_KEY = 'cloudflare_memo_data';

// 添加API请求相关信息
const API_SECURITY = {
  lastCleanup: 0,
  cleanupInterval: 300000, // 5分钟清理间隔
  loginAttempts: new Map(), // 记录登录尝试次数
  maxLoginAttempts: 5, // 最大登录尝试次数
  lockoutDuration: 600000, // 锁定时间（10分钟）
  csrfTokens: new Map(), // 存储CSRF令牌
  csrfTokenExpiry: 1800000 // 令牌有效期（30分钟）
};

// 使用SubtleCrypto API进行密码哈希
async function hashPassword(password, salt) {
  // 如果未提供盐值，生成新的盐值
  if (!salt) {
    const randomBuffer = new Uint8Array(16);
    crypto.getRandomValues(randomBuffer);
    salt = Array.from(randomBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  // 将密码和盐值转换为字节
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password + salt);
  
  // 使用SHA-256哈希
  const hashBuffer = await crypto.subtle.digest('SHA-256', passwordData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // 返回哈希和盐值
  return {
    hash: hashHex,
    salt: salt
  };
}

// 验证密码
async function verifyPassword(inputPassword, storedHash, storedSalt) {
  // 对输入密码使用相同的盐值哈希
  const result = await hashPassword(inputPassword, storedSalt);
  // 比较哈希值
  return result.hash === storedHash;
}

// 生成CSRF令牌
function generateCSRFToken(sessionId) {
  const timestamp = Date.now();
  const randomPart = crypto.getRandomValues(new Uint8Array(16))
    .reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
  
  // 创建令牌
  const token = `${timestamp.toString(36)}-${randomPart}-${sessionId.substring(0, 8)}`;
  
  // 存储令牌及其有效期
  API_SECURITY.csrfTokens.set(token, {
    sessionId: sessionId,
    expiry: timestamp + API_SECURITY.csrfTokenExpiry
  });
  
  return token;
}

// 验证CSRF令牌
function verifyCSRFToken(token, sessionId) {
  if (!token || !API_SECURITY.csrfTokens.has(token)) {
    return false;
  }
  
  const tokenData = API_SECURITY.csrfTokens.get(token);
  const now = Date.now();
  
  // 检查令牌是否过期或与会话不匹配
  if (now > tokenData.expiry || tokenData.sessionId !== sessionId) {
    // 删除过期令牌
    API_SECURITY.csrfTokens.delete(token);
    return false;
  }
  
  return true;
}

// 检查暴力破解尝试
function checkBruteForceAttempt(clientIP) {
  const now = Date.now();
  
  // 获取该IP的登录尝试记录
  if (!API_SECURITY.loginAttempts.has(clientIP)) {
    // 第一次尝试，初始化记录
    API_SECURITY.loginAttempts.set(clientIP, {
      count: 0,
      lastAttempt: now,
      lockedUntil: 0
    });
  }
  
  const attempts = API_SECURITY.loginAttempts.get(clientIP);
  
  // 如果账户被锁定，检查是否已过锁定时间
  if (attempts.lockedUntil > 0) {
    if (now < attempts.lockedUntil) {
      // 仍在锁定时间内
      const remainingTime = Math.ceil((attempts.lockedUntil - now) / 60000); // 剩余分钟数
      return {
        allowed: false,
        locked: true,
        remainingTime: remainingTime,
        message: `账户已锁定，请在${remainingTime}分钟后重试`
      };
    } else {
      // 锁定时间已过，重置记录
      attempts.count = 0;
      attempts.lockedUntil = 0;
    }
  }
  
  // 检查是否在同一时间窗口内（1小时）
  const oneHour = 3600000;
  if (now - attempts.lastAttempt > oneHour) {
    // 超过时间窗口，重置计数
    attempts.count = 0;
  }
  
  // 更新最后尝试时间
  attempts.lastAttempt = now;
  
  // 增加尝试次数
  attempts.count++;
  
  // 检查是否超过最大尝试次数
  if (attempts.count > API_SECURITY.maxLoginAttempts) {
    // 锁定账户
    attempts.lockedUntil = now + API_SECURITY.lockoutDuration;
    return {
      allowed: false,
      locked: true,
      remainingTime: Math.ceil(API_SECURITY.lockoutDuration / 60000),
      message: `尝试次数过多，账户已锁定${Math.ceil(API_SECURITY.lockoutDuration / 60000)}分钟`
    };
  }
  
  // 允许登录尝试
  return {
    allowed: true,
    locked: false,
    remainingAttempts: API_SECURITY.maxLoginAttempts - attempts.count
  };
}

// 记录成功登录
function recordSuccessfulLogin(clientIP) {
  if (API_SECURITY.loginAttempts.has(clientIP)) {
    // 清除该IP的尝试记录
    API_SECURITY.loginAttempts.delete(clientIP);
  }
}

// 清理过期的记录
function cleanupRecords() {
  // 在请求处理中定期清理，而不是使用全局setInterval
  const now = Date.now();
  if (now - API_SECURITY.lastCleanup >= API_SECURITY.cleanupInterval) {
    console.log('执行安全记录清理');
    API_SECURITY.lastCleanup = now;
    
    // 清理过期的登录尝试记录
    for (const [ip, attempts] of API_SECURITY.loginAttempts.entries()) {
      const oneDay = 86400000; // 24小时
      if (now - attempts.lastAttempt > oneDay && attempts.lockedUntil < now) {
        API_SECURITY.loginAttempts.delete(ip);
      }
    }
    
    // 清理过期的CSRF令牌
    for (const [token, data] of API_SECURITY.csrfTokens.entries()) {
      if (now > data.expiry) {
        API_SECURITY.csrfTokens.delete(token);
      }
    }
  }
}

// 在脚本加载时检查KV可用性
function checkKvAvailability() {
  // @ts-ignore
  if (typeof MEMOS_KV !== 'undefined') {
    console.log('KV命名空间已成功绑定到MEMOS_KV变量');
    isKvAvailable = true;
    return true;
  } else {
    console.error('警告: KV命名空间未正确绑定到MEMOS_KV变量，系统将使用备用存储');
    console.error('请确认在Cloudflare Dashboard中已将名为"MEMOS"的KV命名空间绑定到变量名"MEMOS_KV"');
    isKvAvailable = false;
    return false;
  }
}

// 模拟KV存储(使用多种持久化方案)
let memoryStore = { 'all_memos': JSON.stringify([]) };

// 为Worker环境提供localStorage接口
const workerStorage = {
  getItem: (key) => {
    try {
      // 尝试从currentRequest对象中读取cookie
      const cookies = {};
      if (currentRequest && currentRequest.headers.has('Cookie')) {
        const cookieString = currentRequest.headers.get('Cookie') || '';
        cookieString.split(';').forEach(cookie => {
          const parts = cookie.trim().split('=');
          if (parts.length === 2) {
            cookies[parts[0]] = decodeURIComponent(parts[1]);
          }
        });
        if (cookies[key]) {
          return cookies[key];
        }
      }
      return null;
    } catch (e) {
      console.error('workerStorage.getItem错误:', e);
      return null;
    }
  },
  // @ts-ignore
  setItem: (key, value) => {
    try {
      // 这里无法直接设置cookie，因为需要在处理函数中设置响应头
      // 此功能将在处理函数中实现
      console.log('workerStorage尝试设置数据，但需要在响应中设置cookie');
      return true;
    } catch (e) {
      console.error('workerStorage.setItem错误:', e);
      return false;
    }
  }
};

// 获取最适合的存储对象
function getBestStorage() {
  // 检查是否在浏览器环境
  // @ts-ignore
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      // @ts-ignore
      window.localStorage.setItem('test', 'test');
      // @ts-ignore
      window.localStorage.removeItem('test');
      console.log('使用localStorage存储');
      // @ts-ignore
      return window.localStorage;
    } catch (e) {
      console.error('localStorage不可用:', e);
    }
  }
  
  // Worker环境或localStorage不可用
  console.log('使用Worker环境存储');
  return workerStorage;
}

const bestStorage = getBestStorage();

const mockKV = {
  get: async (key) => {
    console.log('使用备用存储获取数据:', key);
    
    // 1. 首先尝试从内存读取（最快）
    if (memoryStore[key]) {
      console.log('从内存中获取数据');
      return memoryStore[key];
    }
    
    // 2. 尝试从localStorage/workerStorage读取
    const storedData = bestStorage.getItem(STORAGE_KEY);
    if (storedData) {
      try {
        console.log('从持久化存储中获取数据');
        const parsedData = JSON.parse(storedData);
        if (parsedData[key]) {
          // 更新内存中的副本
          memoryStore[key] = parsedData[key];
          return parsedData[key];
        }
      } catch (e) {
        console.error('解析存储数据失败:', e);
      }
    }
    
    // 3. 什么都没有找到，返回null
    return null;
  },
  put: async (key, value) => {
    console.log('使用备用存储保存数据:', key);
    
    // 1. 更新内存中的数据
    memoryStore[key] = value;
    
    // 2. 尝试保存到localStorage/workerStorage
    try {
      // 先读取现有数据
      let storedData = bestStorage.getItem(STORAGE_KEY);
      let parsedData = {};
      
      if (storedData) {
        try {
          parsedData = JSON.parse(storedData);
        } catch (e) {
          console.error('解析存储数据失败:', e);
          parsedData = {};
        }
      }
      
      // 更新数据
      parsedData[key] = value;
      
      // 保存回存储
      bestStorage.setItem(STORAGE_KEY, JSON.stringify(parsedData));
      console.log('数据已保存到持久化存储');
    } catch (e) {
      console.error('保存到持久化存储失败:', e);
    }
    
    return true;
  }
};

// 获取有效的KV对象(真实或备用)
function getKV() {
  // @ts-ignore
  return isKvAvailable ? MEMOS_KV : mockKV;
}

// 应用启动自检
(function(){
  // 检查KV可用性
  const kvStatus = checkKvAvailability();
  
  // 输出调试信息
  console.log('应用启动自检:');
  console.log('- KV命名空间状态: ' + (kvStatus ? '可用' : '不可用'));
  // @ts-ignore
  console.log('- MEMOS_KV变量类型: ' + (typeof MEMOS_KV));
  
  // 检查环境变量
  // @ts-ignore
  if (typeof ACCESS_UUID === 'undefined') {
    console.error('警告: ACCESS_UUID环境变量未设置');
  } else {
    console.log('- ACCESS_UUID环境变量: 已设置');
  }
  
  // @ts-ignore
  if (typeof ACCESS_PASSWORD === 'undefined') {
    console.log('- ACCESS_PASSWORD环境变量: 未设置 (可选)');
  } else {
    console.log('- ACCESS_PASSWORD环境变量: 已设置');
  }
  
  // @ts-ignore
  if (typeof ACCESS_MULTIFACTOR === 'undefined') {
    console.log('- ACCESS_MULTIFACTOR环境变量: 未设置 (可选)');
  } else {
    console.log('- ACCESS_MULTIFACTOR环境变量: 已设置，已启用多重验证');
  }
})();

// 认证相关
let isAuthenticated = false;
const SESSION_DURATION = 7200000; // 会话有效期：2小时
let authExpiry = 0;
let authClientInfo = {
  ip: null,
  userAgent: null,
  lastActivity: 0,
  sessionId: null, // 添加会话ID
  sessionKey: null  // 添加会话密钥
};

// 检查认证状态
function checkAuth() {
  const now = Date.now();
  
  // 如果未认证或已过期，直接返回false
  if (!isAuthenticated || now >= authExpiry) {
    if (isAuthenticated && now >= authExpiry) {
      console.log('会话已过期');
      // 重置认证状态
      setAuth(false);
    }
    return false;
  }
  
  // 更新最后活动时间
  authClientInfo.lastActivity = now;
  
  // 检查客户端信息（如果有）
  if (currentRequest && authClientInfo.ip && authClientInfo.userAgent) {
    const currentIP = currentRequest.headers.get('CF-Connecting-IP') || 
                     currentRequest.headers.get('X-Forwarded-For') || 
                     'unknown';
    const currentUA = currentRequest.headers.get('User-Agent') || 'unknown';
    
    // 检查客户端信息是否匹配（IP和UA至少一个必须匹配，以允许移动网络IP变化）
    const ipMatch = (currentIP === authClientInfo.ip);
    const uaMatch = (currentUA === authClientInfo.userAgent);
    
    if (!ipMatch && !uaMatch) {
      console.error('客户端信息不匹配，可能的会话劫持尝试');
      console.error(`存储的IP: ${authClientInfo.ip}, 当前IP: ${currentIP}`);
      console.error(`UA匹配: ${uaMatch}`);
      
      // 可能是会话劫持，重置认证状态
      setAuth(false);
      return false;
    }
  }
  
  // 延长会话时间（如果活动超过会话期限的一半）
  if (now - authClientInfo.lastActivity > SESSION_DURATION / 2) {
    console.log('活动检测，延长会话时间');
    // 延长会话，但不完全重置，以确保总时间不超过两倍SESSION_DURATION
    authExpiry = Math.min(now + SESSION_DURATION, authClientInfo.lastActivity + SESSION_DURATION * 2);
  }
  
  return true;
}

// 设置认证状态
function setAuth(value, sessionId = null) {
  isAuthenticated = value;
  
  if (value) {
    // 设置新的过期时间
    authExpiry = Date.now() + SESSION_DURATION;
    
    // 如果提供了会话ID，则使用它；否则生成一个新的
    const newSessionId = sessionId || generateId();
    
    // 生成会话密钥（用于在请求之间验证会话完整性）
    const sessionKey = crypto.getRandomValues(new Uint8Array(32))
      .reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
    
    // 存储客户端信息用于会话验证
    if (currentRequest) {
      authClientInfo = {
        ip: currentRequest.headers.get('CF-Connecting-IP') || 
            currentRequest.headers.get('X-Forwarded-For') || 
            'unknown',
        userAgent: currentRequest.headers.get('User-Agent') || 'unknown',
        lastActivity: Date.now(),
        sessionId: newSessionId,
        sessionKey: sessionKey
      };
      console.log('已存储客户端信息用于会话验证，会话ID:', newSessionId.substring(0, 8) + '...');
      
      // 在KV存储中保存会话数据，如果KV可用
      if (isKvAvailable) {
        try {
          // 安全地存储会话数据
          const sessionData = {
            ip: authClientInfo.ip,
            userAgent: authClientInfo.userAgent,
            createdAt: Date.now(),
            expiresAt: authExpiry,
            sessionKey: sessionKey
          };
          
          // 异步存储会话数据
          const kv = getKV();
          kv.put(`session:${newSessionId}`, JSON.stringify(sessionData), {
            expirationTtl: Math.floor(SESSION_DURATION / 1000) // 转换为秒
          }).catch(err => {
            console.error('存储会话数据失败:', err);
          });
        } catch (e) {
          console.error('准备会话数据存储时出错:', e);
        }
      }
    }
  } else {
    authExpiry = 0;
    
    // 如果存在会话ID，尝试从KV存储中删除
    if (authClientInfo.sessionId && isKvAvailable) {
      try {
        const kv = getKV();
        kv.delete(`session:${authClientInfo.sessionId}`).catch(err => {
          console.error('删除会话数据失败:', err);
        });
      } catch (e) {
        console.error('尝试删除会话数据时出错:', e);
      }
    }
    
    // 清除客户端信息
    authClientInfo = {
      ip: null,
      userAgent: null,
      lastActivity: 0,
      sessionId: null,
      sessionKey: null
    };
  }
  
  return authClientInfo.sessionId; // 返回会话ID
}

// 动态安全锁相关
let dynamicSecurityLock = {
  uuid: null,
  expiryTime: 0,
  interval: 10000, // 10秒更新一次
  lastUpdate: 0
};

// 生成新的动态安全锁
function regenerateDynamicLock() {
  // 生成新的UUID，增加熵值和随机性
  const timestamp = Date.now().toString(36);
  const randomPart1 = Math.random().toString(36).substr(2, 8);
  const randomPart2 = Math.random().toString(36).substr(2, 8);
  const randomPart3 = Math.random().toString(36).substr(2, 5);
  const newUuid = `${timestamp}-${randomPart1}-${randomPart2}-${randomPart3}`;
  
  // 设置失效时间（当前时间 + 间隔时间）
  const expiryTime = Date.now() + dynamicSecurityLock.interval;
  
  // 保存当前的lastUpdate值，如果存在的话
  const lastUpdate = dynamicSecurityLock.lastUpdate || Date.now();
  
  // 更新动态锁，保留现有的lastUpdate
  dynamicSecurityLock = {
    uuid: newUuid,
    expiryTime: expiryTime,
    interval: dynamicSecurityLock.interval,
    lastUpdate: lastUpdate
  };
  
  console.log('已更新动态安全锁');
  
  return dynamicSecurityLock.uuid;
}

// 验证动态安全锁
function verifyDynamicLock(providedLock) {
  // 检查输入是否有效
  if (!providedLock || typeof providedLock !== 'string') {
    console.error('动态锁验证失败: 提供的锁无效或格式错误');
    return false;
  }
  
  // 检查锁是否已过期，如果过期则重新生成
  if (Date.now() > dynamicSecurityLock.expiryTime) {
    console.log('动态锁已过期，生成新锁');
    regenerateDynamicLock();
    return false;
  }
  
  // 验证提供的锁与当前锁是否匹配
  const isValid = providedLock === dynamicSecurityLock.uuid;
  
  if (!isValid) {
    console.error('动态锁验证失败: 锁不匹配');
  }
  
  return isValid;
}

// 启动动态锁定时器
function startDynamicLockTimer() {
  try {
  // 初始生成一个动态锁
  regenerateDynamicLock();
    console.log('初始动态安全锁已生成，间隔时间:', dynamicSecurityLock.interval, 'ms');
    
    // 注意：在Worker环境中，不能在全局作用域使用setInterval
    // 创建一个时间戳，用于检查是否需要更新锁
    dynamicSecurityLock.lastUpdate = Date.now();
    
    console.log('动态安全锁已初始化');
    return true;
  } catch (error) {
    console.error('启动动态锁定时器失败:', error);
    return false;
  }
}

// 在应用启动时初始化动态锁
// startDynamicLockTimer();  // 删除这一行，改为在处理请求时初始化

// 在请求处理过程中检查并更新动态锁
function checkAndUpdateDynamicLock() {
  // 如果锁未初始化，先初始化
  if (!dynamicSecurityLock.uuid) {
    regenerateDynamicLock();
    dynamicSecurityLock.lastUpdate = Date.now();
    return;
  }
  
  // 检查是否需要更新锁（基于时间间隔）
  const now = Date.now();
  if (now - dynamicSecurityLock.lastUpdate >= dynamicSecurityLock.interval) {
    regenerateDynamicLock();
    dynamicSecurityLock.lastUpdate = now;
    console.log('已在请求处理中更新动态安全锁');
  }
}

// HTML模板 - 主页
const indexHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>备忘录管理系统</title>
  <link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=" type="image/svg+xml" id="app-favicon">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap">
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --primary-light: #dbeafe;
      --secondary: #f97316;
      --secondary-hover: #ea580c;
      --danger: #ef4444;
      --danger-hover: #dc2626;
      --success: #10b981;
      --success-hover: #059669;
      --gray-50: #f9fafb;
      --gray-100: #f3f4f6;
      --gray-200: #e5e7eb;
      --gray-300: #d1d5db;
      --gray-400: #9ca3af;
      --gray-500: #6b7280;
      --gray-600: #4b5563;
      --gray-700: #374151;
      --gray-800: #1f2937;
      --gray-900: #111827;
      --border-radius: 8px;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      --anim-duration: 0.2s;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    html {
      font-size: 16px;
    }
    
    body {
      background-color: var(--gray-100);
      color: var(--gray-800);
      line-height: 1.5;
      min-height: 100vh;
      padding: 1.25rem;
    }
    
    .container {
      display: flex;
      max-width: 1200px;
      margin: 0 auto;
      gap: 1.25rem;
    }
    
    .left-column {
      flex: 1;
      min-width: 300px;
    }
    
    .right-column {
      flex: 1;
      min-width: 300px;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--gray-200);
    }
    
    .header-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .app-logo {
      height: 32px;
      width: auto;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      background-color: white;
      padding: 3px;
    }
    
    .header-actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    
    .settings-btn {
      background-color: transparent;
      color: var(--gray-600);
      border: 1px solid var(--gray-300);
      border-radius: var(--border-radius);
      height: 2rem;
      padding: 0 0.75rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 0.875rem;
    }
    
    .settings-btn:hover {
      background-color: var(--gray-100);
      color: var(--gray-800);
    }
    
    .action-btn {
      background-color: transparent;
      color: var(--gray-600);
      border: 1px solid var(--gray-300);
      border-radius: var(--border-radius);
      width: 2rem;
      height: 2rem;
      padding: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .action-btn:hover {
      background-color: var(--gray-100);
      color: var(--gray-800);
    }
    
    .backup-info {
      margin-bottom: 1rem;
      padding: 0.75rem;
      border-radius: var(--border-radius);
      background-color: var(--primary-light);
      font-size: 0.875rem;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    h1 {
      color: var(--gray-800);
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0;
    }
    
    .card {
      background-color: white;
      border-radius: var(--border-radius);
      box-shadow: var(--shadow);
      transition: box-shadow var(--anim-duration) ease;
      overflow: hidden;
      margin-bottom: 1.25rem;
    }
    
    /* 备忘录列表卡片特殊样式 */
    .card.memos-card {
      background-color: transparent;
    }
    
    .card:hover {
      box-shadow: var(--shadow-md);
    }
    
    .card-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--gray-200);
      font-weight: 600;
      font-size: 1.125rem;
      color: var(--gray-800);
      background-color: var(--gray-50);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    /* 备忘录列表卡片标题栏特殊样式 */
    .memos-card .card-header {
      background-color: var(--gray-50); /* 还原为原始的背景颜色 */
      border-bottom-color: var(--gray-200); /* 还原为原始的边框颜色 */
    }
    
    .header-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .memo-count {
      font-size: 0.75rem;
      color: var(--gray-500);
      font-weight: normal;
      margin-left: 0.25rem;
    }
    
    .card-body {
      padding: 1.25rem;
    }
    
    /* 备忘录列表卡片没有内边距，让网格布局控制间距 */
    .card-body.memos-container {
      padding: 0;
      background-color: transparent;
    }
    
    .memo-form {
      padding: 0;
    }
    
    .form-group {
      margin-bottom: 1rem;
    }
    
    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
      color: var(--gray-700);
      font-size: 0.875rem;
    }
    
    input, textarea, select {
      width: 100%;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--gray-300);
      border-radius: var(--border-radius);
      font-size: 0.875rem;
      transition: all var(--anim-duration) ease;
    }
    
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    
    textarea {
      min-height: 150px;
      resize: vertical;
      line-height: 1.6;
    }
    
    button {
      padding: 0.625rem 1rem;
      border: none;
      border-radius: var(--border-radius);
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      transition: all var(--anim-duration) ease;
    }
    
    .btn-primary {
      background-color: var(--primary);
      color: white;
    }
    
    .btn-primary:hover {
      background-color: var(--primary-hover);
    }
    
    .btn-secondary {
      background-color: var(--gray-200);
      color: var(--gray-700);
    }
    
    .btn-secondary:hover {
      background-color: var(--gray-300);
    }
    
    .btn-danger {
      background-color: var(--danger);
      color: white;
    }
    
    .btn-danger:hover {
      background-color: var(--danger-hover);
    }
    
    .btn-sm {
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
    }
    
    .memos-list {
      height: calc(100% - 1.25rem);
      min-height: 400px;
      overflow-y: auto;
      margin-top: 1rem;
      transition: opacity 0.2s ease;
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
      padding: 1rem;
      background-color: transparent;
    }
    
    .memos-list.loading {
      opacity: 0.6;
      pointer-events: none;
    }
    
    .memo-item {
      padding: 1.25rem;
      background-color: white;
      border-radius: var(--border-radius);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      transition: all 0.2s ease;
      border: 1px solid var(--gray-200);
      position: relative;
      overflow: hidden;
      z-index: 1;
      /* 添加固定高度 */
      min-height: 220px;
      display: flex;
      flex-direction: column;
    }
    
    /* 气泡背景容器 */
    .memo-item .bubble-bg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      z-index: -1;
      opacity: 0.15; /* 半透明 */
      pointer-events: none; /* 防止气泡影响点击事件 */
    }
    
    /* 气泡样式 */
    .bubble {
      position: absolute;
      border-radius: 50%;
      background: var(--primary);
      animation-name: bubble-float;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
      opacity: 0.7;
    }
    
    /* 气泡动画 */
    @keyframes bubble-float {
      0% {
        transform: translateY(0) translateX(0) scale(1);
        opacity: 0.7;
      }
      100% {
        transform: translateY(-100px) translateX(20px) scale(1.5);
        opacity: 0;
      }
    }
    
    /* 不同颜色的气泡 */
    .bubble.primary { background: var(--primary); }
    .bubble.secondary { background: var(--secondary); }
    .bubble.danger { background: var(--danger); }
    .bubble.success { background: var(--success); }
    .bubble.gray { background: var(--gray-500); }
    
    .memo-item:hover {
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transform: translateY(-2px);
      border-color: var(--gray-300);
    }
    
    .memo-item:hover .bubble {
      animation-play-state: running;
    }
    
    .memo-item:not(:hover) .bubble {
      animation-play-state: paused;
    }
    
    .memo-item::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background-color: var(--primary);
      opacity: 0.7;
    }
    
    .memo-item[data-color="1"]::before {
      background-color: var(--primary);
    }
    
    .memo-item[data-color="2"]::before {
      background-color: var(--secondary);
    }
    
    .memo-item[data-color="3"]::before {
      background-color: var(--danger);
    }
    
    .memo-item[data-color="4"]::before {
      background-color: var(--success);
    }
    
    .memo-item[data-color="5"]::before {
      background-color: var(--gray-500);
    }
    
    .memo-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--gray-800);
      margin-bottom: 0.5rem;
      line-height: 1.3;
    }
    
    .memo-content {
      color: var(--gray-600);
      margin-bottom: 1rem;
      font-size: 0.875rem;
      line-height: 1.6;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      /* 添加最大高度限制 */
      max-height: 4.8em; /* 3行文字的高度 */
      flex: 1;
    }
    
    .memo-category {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 99px;
      font-size: 0.75rem;
      font-weight: 500;
      margin-bottom: 0.75rem;
      color: white;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
    
    .memo-date {
      color: var(--gray-500);
      font-size: 0.75rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
    }
    
    .memo-date::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background-color: var(--gray-400);
      margin-right: 0.5rem;
    }
    
    .memo-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: auto; /* 自动上边距确保按钮在底部 */
      border-top: 1px solid var(--gray-100);
      padding-top: 1rem;
      width: 100%;
    }
    
    .memo-actions button {
      flex: 1;
      padding: 0.5rem;
      border-radius: var(--border-radius);
      font-size: 0.875rem;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    
    .btn-edit {
      background-color: var(--gray-100);
      color: var(--gray-700);
      border: 1px solid var(--gray-200);
    }
    
    .btn-edit:hover {
      background-color: var(--gray-200);
    }
    
    .btn-delete {
      background-color: var(--gray-100);
      color: var(--danger);
      border: 1px solid var(--gray-200);
    }
    
    .btn-delete:hover {
      background-color: var(--gray-200);
    }

    /* 媒体查询，在较大屏幕上使用多列布局 */
    @media (min-width: 768px) {
      .memos-list {
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      }
    }
    
    @media (max-width: 767px) {
      .memos-list {
        padding: 0.75rem;
        gap: 0.75rem;
      }
      
      .memo-item {
        padding: 1rem;
      }
    }
    
    .memo-item:last-child {
      border-bottom: none;
    }
    
    .memo-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--gray-800);
      margin-bottom: 0.375rem;
    }
    
    .memo-content {
      color: var(--gray-600);
      margin-bottom: 0.625rem;
      font-size: 0.875rem;
      line-height: 1.5;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }
    
    .memo-category {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 99px;
      font-size: 0.75rem;
      font-weight: 500;
      margin-bottom: 0.625rem;
      color: white;
    }
    
    .category-color-1 {
      background-color: var(--primary);
    }
    
    .category-color-2 {
      background-color: var(--secondary);
    }
    
    .category-color-3 {
      background-color: var(--danger);
    }
    
    .category-color-4 {
      background-color: var(--success);
    }
    
    .category-color-5 {
      background-color: var(--gray-500);
    }
    
    .category-input-container {
      position: relative;
    }
    
    .category-color-picker {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    
    .color-dot {
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      cursor: pointer;
      transition: transform 0.2s ease;
      border: 2px solid transparent;
    }
    
    .color-dot:hover {
      transform: scale(1.1);
    }
    
    .color-dot.selected {
      border-color: var(--gray-300);
      transform: scale(1.1);
    }
    
    .color-1 {
      background-color: var(--primary);
    }
    
    .color-2 {
      background-color: var(--secondary);
    }
    
    .color-3 {
      background-color: var(--danger);
    }
    
    .color-4 {
      background-color: var(--success);
    }
    
    .color-5 {
      background-color: var(--gray-500);
    }
    
    .memo-date {
      color: var(--gray-500);
      font-size: 0.75rem;
      margin-bottom: 0.625rem;
    }
    
    .memo-actions {
      display: flex;
      gap: 0.5rem;
    }
    
    .memo-actions button {
      flex: 1;
    }
    
    .btn-edit {
      background-color: var(--gray-200);
      color: var(--gray-700);
    }
    
    .btn-edit:hover {
      background-color: var(--gray-300);
    }
    
    .btn-delete {
      background-color: var(--gray-200);
      color: var(--danger);
    }
    
    .btn-delete:hover {
      background-color: var(--gray-300);
    }
    
    .logout-btn {
      font-size: 0.75rem;
      padding: 0.375rem 0.75rem;
      background-color: var(--gray-200);
      color: var(--gray-700);
    }
    
    .logout-btn:hover {
      background-color: var(--gray-300);
    }
    
    .status-message {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border-radius: var(--border-radius);
      font-size: 0.875rem;
      display: none;
    }
    
    .success {
      background-color: #ecfdf5;
      color: var(--success);
      border: 1px solid #a7f3d0;
    }
    
    .error {
      background-color: #fef2f2;
      color: var(--danger);
      border: 1px solid #fecaca;
    }
    
    /* 模态框样式 */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s ease, visibility 0.3s ease;
    }
    
    .modal-overlay.active {
      opacity: 1;
      visibility: visible;
    }
    
    .modal {
      background-color: white;
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-lg);
      max-width: 500px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      transform: translateY(-20px);
      transition: transform 0.3s ease;
    }
    
    .modal-overlay.active .modal {
      transform: translateY(0);
    }
    
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--gray-200);
    }
    
    .modal-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--gray-800);
    }
    
    .modal-close {
      background-color: transparent;
      border: none;
      color: var(--gray-500);
      cursor: pointer;
      font-size: 1.25rem;
      padding: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s ease;
    }
    
    .modal-close:hover {
      color: var(--gray-800);
    }
    
    .modal-body {
      padding: 1.25rem;
    }
    
    .modal-footer {
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--gray-200);
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }
    
    .settings-group {
      margin-bottom: 1.5rem;
    }
    
    .settings-group:last-child {
      margin-bottom: 0;
    }
    
    .settings-group-title {
      font-weight: 600;
      margin-bottom: 0.75rem;
      color: var(--gray-700);
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    /* 自定义 Logo 上传样式 */
    .logo-preview {
      width: 100%;
      height: 120px;
      border: 2px dashed var(--gray-300);
      border-radius: var(--border-radius);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin-bottom: 1rem;
      background-color: var(--gray-50);
      overflow: hidden;
      position: relative;
    }
    
    .logo-preview img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 12px;
      background-color: white;
      padding: 5px;
      box-shadow: 0 3px 6px rgba(0, 0, 0, 0.1);
    }
    
    .logo-controls {
      display: flex;
      gap: 0.5rem;
    }
    
    .logo-upload-btn {
      display: inline-block;
      position: relative;
      overflow: hidden;
    }
    
    .logo-upload-btn input[type="file"] {
      position: absolute;
      top: 0;
      right: 0;
      min-width: 100%;
      min-height: 100%;
      opacity: 0;
      cursor: pointer;
    }
    
    .form-hint {
      display: block;
      margin-top: 0.25rem;
      font-size: 0.75rem;
      color: var(--gray-500);
    }
    
    .loading {
      text-align: center;
      padding: 2rem;
      color: var(--gray-500);
      font-size: 0.875rem;
    }
    
    .spinner {
      display: inline-block;
      width: 1.25rem;
      height: 1.25rem;
      border: 2px solid rgba(37, 99, 235, 0.3);
      border-radius: 50%;
      border-top-color: var(--primary);
      animation: spin 1s linear infinite;
      margin-right: 0.5rem;
      vertical-align: middle;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .list-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--gray-800);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .memo-count {
      font-size: 0.75rem;
      color: var(--gray-500);
      font-weight: 400;
    }
    
    .refresh-btn {
      background-color: transparent;
      color: var(--primary);
      border: none;
      font-size: 0.75rem;
      cursor: pointer;
      padding: 0;
      font-weight: 500;
    }
    
    .refresh-btn:hover {
      text-decoration: underline;
      background-color: transparent;
    }
    
    .no-memos {
      text-align: center;
      color: var(--gray-500);
      padding: 2rem;
      font-size: 0.875rem;
    }
    
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1.5rem;
      text-align: center;
    }
    
    .empty-state-icon {
      width: 4rem;
      height: 4rem;
      color: var(--gray-300);
      margin-bottom: 1rem;
    }
    
    .empty-state-text {
      font-size: 0.875rem;
      color: var(--gray-500);
      margin-bottom: 1.5rem;
    }
    
    select {
      width: 100%;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--gray-300);
      border-radius: var(--border-radius);
      font-size: 0.875rem;
      background-color: white;
      transition: all var(--anim-duration) ease;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%234b5563' viewBox='0 0 16 16'%3E%3Cpath d='M8 11.5a.5.5 0 0 1-.354-.146l-4-4a.5.5 0 1 1 .708-.708L8 10.293l3.646-3.647a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.354.146z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.75rem center;
      background-size: 16px 16px;
    }
    
    select:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    
    @media (max-width: 768px) {
      .container {
        flex-direction: column;
      }
      .left-column, .right-column {
        width: 100%;
      }
    }
    
    /* 分页控件样式优化 */
    .pagination {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-top: 1rem;
      padding: 0.75rem 0;
      border-top: 1px solid var(--gray-200);
      width: 100%;
    }
    
    .pagination-info {
      margin-bottom: 0.75rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--gray-600);
      background-color: var(--gray-50);
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      display: inline-block;
    }
    
    .pagination-controls {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      width: 100%;
    }
    
    .page-btn {
      padding: 0.375rem 0.75rem;
      border: 1px solid var(--gray-300);
      border-radius: var(--border-radius);
      background-color: white;
      color: var(--gray-700);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all var(--anim-duration) ease;
      min-width: 2.5rem;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 2.25rem;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    
    .page-btn:active {
      transform: scale(0.95);
      background-color: var(--gray-200);
    }
    
    .page-btn.page-nav {
      min-width: 4.5rem;
    }
    
    .page-btn:hover:not(:disabled) {
      background-color: var(--gray-100);
      border-color: var(--gray-400);
    }
    
    .page-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .page-btn.active {
      background-color: var(--primary);
      color: white;
      border-color: var(--primary);
      font-weight: 500;
    }
    
    .page-btn.active:hover {
      background-color: var(--primary-hover);
    }
    
    .page-btn.clicked {
      transform: scale(0.95);
      background-color: var(--gray-200);
    }
    
    .page-btn.active.clicked {
      background-color: var(--primary-hover);
    }
    
    .page-size-control {
      display: flex;
      align-items: center;
      margin-left: 0.75rem;
      background-color: var(--gray-50);
      border-radius: var(--border-radius);
      padding: 0 0.25rem;
      border: 1px solid var(--gray-300);
    }
    
    .page-size-label {
      font-size: 0.75rem;
      color: var(--gray-600);
      padding: 0 0.25rem;
    }
    
    .page-size-select {
      padding: 0.375rem 0.25rem;
      border: none;
      background-color: transparent;
      color: var(--gray-700);
      font-size: 0.8rem;
      cursor: pointer;
      font-weight: 500;
    }
    
    .pagination-dots {
      color: var(--gray-500);
      margin: 0 0.25rem;
      align-self: center;
    }
    
    /* 移动设备适配 */
    @media (max-width: 640px) {
      :root {
        --header-height: 2.5rem;
      }
      
      body header {
        padding: 0 0.5rem;
      }
      
      body main {
        padding: 0.75rem;
      }
      
      .page-title-text {
        font-size: 1.125rem;
      }
      
      .memo-container {
        padding: 0.75rem;
      }
      
      .form-group {
        margin-bottom: 0.75rem;
      }
      
      .form-group label {
        margin-bottom: 0.25rem;
      }
      
      .pagination {
        padding: 0.5rem 0;
        margin-top: 0.75rem;
      }
      
      .pagination-info {
        font-size: 0.7rem;
        margin-bottom: 0.5rem;
      }
      
      .pagination-controls {
        gap: 0.3rem;
      }
      
      .page-btn {
        min-width: 2rem;
        padding: 0.3rem 0.5rem;
        font-size: 0.8rem;
        height: 2rem;
        touch-action: manipulation; /* 优化触摸事件处理 */
      }
      
      .page-btn.page-nav {
        min-width: 3.5rem;
        font-size: 0.75rem;
      }
      
      .page-size-control {
        margin-left: 0.5rem;
      }
      
      .page-size-label {
        font-size: 0.7rem;
      }
      
      .page-size-select {
        font-size: 0.7rem;
      }
    }
    
    /* 搜索框样式 */
    .search-container {
      display: flex;
      align-items: center;
      margin-right: 0.5rem;
      position: relative;
    }
    
    .search-input {
      width: 200px;
      padding: 0.5rem 2.5rem 0.5rem 0.75rem;
      border: 1px solid var(--gray-300);
      border-radius: var(--border-radius);
      font-size: 0.875rem;
      transition: all var(--anim-duration) ease;
      background-color: white;
    }
    
    .search-input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
      width: 250px;
    }
    
    .search-btn {
      position: absolute;
      right: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--gray-500);
      cursor: pointer;
      padding: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s ease;
    }
    
    .search-btn:hover {
      color: var(--primary);
    }
    
    @media (max-width: 768px) {
      .search-input {
        width: 150px;
      }
      
      .search-input:focus {
        width: 180px;
      }
    }
    
    .multi-auth-section {
      display: none;
      padding-top: 0.5rem;
      margin-top: 0.75rem;
      margin-bottom: 1.25rem;
      border-top: none; /* 删除黑色分隔线 */
      animation: fadeIn 0.3s ease;
    }
    
    .multi-auth-section .form-group {
      margin-bottom: 0;
      margin-top: 0.75rem;
    }
    
    .multi-auth-icon {
      margin-right: 0.375rem;
      vertical-align: text-bottom;
      color: var(--primary);
    }
    
    .multi-auth-hint {
      margin-top: 0.375rem;
      font-size: 0.75rem;
      color: var(--gray-500);
      line-height: 1.4;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    /* 验证按钮额外间距 */
    .form-group.submit-group {
      margin-top: 1.5rem;
    }
    
    /* 安全提示样式 */
    .security-info {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--gray-200);
      color: var(--gray-600);
      font-size: 0.75rem;
    }
    
    .security-info svg {
      width: 1rem;
      height: 1rem;
      margin-right: 0.5rem;
      fill: #3b82f6;
    }
    
    .security-info span {
      white-space: nowrap;
    }
    
    /* 安全ID */
    .security-id {
      text-align: center;
      margin-top: 0.5rem;
      font-size: 0.65rem;
      color: var(--gray-500);
      opacity: 0.8;
      font-family: monospace;
      letter-spacing: 0.5px;
    }
    
    .security-id-label {
      color: var(--gray-600);
      margin-right: 0.5rem;
    }
    
    /* 登录页面气泡样式 */
    .login-bubble {
      position: absolute;
      border-radius: 50%;
      background: var(--primary);
      animation-name: login-bubble-float;
      animation-timing-function: cubic-bezier(0.45, 0.05, 0.55, 0.95);
      animation-iteration-count: infinite;
      opacity: 0.4;
      filter: blur(1px);
      transform-origin: center;
      will-change: transform, opacity;
      /* 简化气泡效果，降低GPU压力 */
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.2) 15%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--primary); /* 内部高光效果 */
      box-shadow: 
        inset 0 0 5px rgba(255, 255, 255, 0.4),
        0 0 5px rgba(255, 255, 255, 0.2); /* 简化阴影效果 */
      border: 0; /* 移除边框 */
    }
    
    /* 不同颜色的气泡 - 简化背景渐变 */
    .login-bubble.primary { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--primary); 
    }
    .login-bubble.secondary { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--secondary); 
    }
    .login-bubble.danger { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--danger); 
    }
    .login-bubble.success { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--success); 
    }
    .login-bubble.gray { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--gray-700); 
    }
    .login-bubble.teal { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--teal, #14b8a6); 
    }
    .login-bubble.amber { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--amber, #f59e0b); 
    }
    .login-bubble.pink { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--pink, #ec4899); 
    }
    .login-bubble.indigo { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--indigo, #6366f1); 
    }
    
    /* 登录气泡动画 - 简化变形和动画帧 */
    @keyframes login-bubble-float {
      0% {
        transform: translateY(0) translateX(0) rotate(0deg);
        opacity: 0.3;
      }
      50% {
        transform: translateY(-50vh) translateX(var(--bubble-x-offset-3, 5px)) rotate(var(--bubble-rotate-3, 135deg));
        opacity: 0.4;
      }
      100% {
        transform: translateY(-100vh) translateX(var(--bubble-x-offset-5, 20px)) rotate(var(--bubble-rotate-5, 180deg));
        opacity: 0;
      }
    }
    
    /* 添加新的样式定义在CSS部分 */
    .memo-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
    }
    
    .memo-footer {
      margin-top: auto;
      width: 100%;
    }
    
    .memo-footer .memo-date {
      margin-bottom: 0.75rem;
    }
    
    .memo-actions {
      display: flex;
      gap: 0.75rem;
      border-top: 1px solid var(--gray-100);
      padding-top: 0.75rem;
      width: 100%;
    }
    
    .search-clear-btn {
      display: inline-block;
      margin-left: 8px;
      padding: 2px 8px;
      background-color: var(--gray-200);
      color: var(--gray-700);
      border: none;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    
    .search-clear-btn:hover {
      background-color: var(--gray-300);
    }
    
    .search-result-indicator {
      background-color: var(--primary-light);
      color: var(--primary);
      font-weight: 500;
      padding: 0 4px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=" class="app-logo" id="app-logo" alt="备忘录管理系统">
    <h1>备忘录管理系统</h1>
    </div>
    <div class="header-actions">
      <div class="search-container">
        <input type="text" id="searchInput" class="search-input" placeholder="搜索备忘录...">
        <button id="searchBtn" class="search-btn" title="搜索">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
          </svg>
        </button>
      </div>
      <button id="exportBtn" class="action-btn" title="导出备份">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
          <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
          <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
        </svg>
      </button>
      <button id="importBtn" class="action-btn" title="导入备份">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
          <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
          <path d="M7.646 4.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 5.707v8.793a.5.5 0 0 1-1 0V5.707L5.354 7.854a.5.5 0 1 1-.708-.708l3-3z"/>
        </svg>
      </button>
      <button id="settingsBtn" class="settings-btn" title="设置">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
          <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
        </svg>
        设置
      </button>
      <input type="file" id="importFile" accept=".json" style="display:none">
      <button id="logoutBtn" class="logout-btn">退出登录</button>
    </div>
  </div>
  
  <!-- 设置模态框 -->
  <div class="modal-overlay" id="settingsModal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">系统设置</h3>
        <button class="modal-close" id="closeSettingsModal">×</button>
      </div>
      <div class="modal-body">
        <div class="settings-group">
          <h4 class="settings-group-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M13.902.334a.5.5 0 0 1-.28.65l-2.254.902-.4 1.927c.376.095.715.215.972.367.228.135.56.396.56.82 0 .046-.004.09-.011.132l-.012.071a.5.5 0 0 1-.148.3.5.5 0 0 1-.238.1A2.79 2.79 0 0 1 11 5.5c.01-.103.023-.197.038-.29.013-.075.029-.15.049-.222l.011-.046.013-.049c.005-.022.023-.044.051-.069a.4.4 0 0 1 .212-.099c.136-.032.288-.044.456-.044h.042c.139 0 .375.03.625.208.249.177.461.457.612.84 0 0 .306 1.087.297 2.616-.02 2.754-.275 3.532-.352 3.749a3.2 3.2 0 0 1-.506 1.07c-.478.641-1.396 1.246-3.146 1.246C6.261 14.492 3 12.476 3 8.75c0-1.33.253-2.48.782-3.371C4.29 4.54 5.02 3.852 5.892 3.39 6.746 2.937 7.675 2.705 8.65 2.705c.906 0 1.591.209 2.09.627.468.392.756.95.892 1.666l.684-.27L13.9.334a.5.5 0 0 1 .002 0ZM8.5 5.093c-.508-.006-.992.041-1.438.14-.448.1-.864.252-1.21.458-.357.21-.674.466-.936.775a3.77 3.77 0 0 0-.306.368.288.288 0 0 0 .13.392c.077.039.186.04.264.004 2.262-1.032 4.281-.446 5.244.447a.294.294 0 0 0 .262.064.283.283 0 0 0 .195-.208c.03-.113.026-.262-.035-.436-.156-.396-.443-.773-.903-1.07-.459-.296-1.108-.522-1.987-.525a4.99 4.99 0 0 0-.28.01Z"/>
            </svg>
            自定义系统标题
          </h4>
          <div class="form-group">
            <div style="display: flex; gap: 0.5rem;">
              <input type="text" id="customTitle" class="form-control" placeholder="输入自定义系统标题" maxlength="30" style="flex: 1;">
              <button type="button" class="btn-secondary" id="resetTitleBtn">重置</button>
            </div>
            <small class="form-hint">最多30个字符，留空则使用默认标题</small>
            <small class="form-hint" style="margin-top: 5px; background-color: var(--primary-light); padding: 5px; border-radius: 4px; color: var(--primary);">提示: 标题将显示在所有页面顶部</small>
          </div>
        </div>
        
        <div class="settings-group">
          <h4 class="settings-group-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
              <path d="M10.97 4.97a.235.235 0 0 0-.02.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05z"/>
            </svg>
            自定义Logo
          </h4>
          <small class="form-hint" style="margin-bottom: 10px; background-color: var(--primary-light); padding: 5px; border-radius: 4px; color: var(--primary);">提示: Logo将以圆角形式显示在所有页面上，包括登录界面</small>
          <div class="logo-preview" id="logoPreview">
            <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=" id="previewImage" alt="Logo预览">
          </div>
          <div class="logo-controls">
            <div class="logo-upload-btn">
              <button type="button" class="btn-secondary" id="uploadLogoBtn">上传Logo</button>
              <input type="file" id="logoUpload" accept="image/*">
            </div>
            <button type="button" class="btn-secondary" id="resetLogoBtn">恢复默认</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" id="cancelSettingsBtn">取消</button>
        <button type="button" class="btn-primary" id="saveSettingsBtn">保存设置</button>
      </div>
    </div>
  </div>
  
  <div class="container">
    <div class="left-column">
      <div class="card">
        <div class="card-header">添加新备忘录</div>
        <div class="card-body">
          <form id="memoForm" class="memo-form">
            <input type="hidden" id="memoId" name="id">
            <div class="form-group">
              <label for="title">标题</label>
              <input type="text" id="title" name="title" placeholder="请输入备忘录标题" required>
            </div>
            <div class="form-group">
              <label for="content">内容</label>
              <textarea id="content" name="content" placeholder="请输入备忘录内容" required></textarea>
            </div>
            <div class="form-group">
              <label for="category">分类</label>
              <div class="category-input-container">
                <input type="text" id="category" name="category" placeholder="输入分类名称" list="category-suggestions">
                <datalist id="category-suggestions">
                  <option value="工作">
                  <option value="个人">
                  <option value="重要">
                  <option value="想法">
                  <option value="其他">
                </datalist>
                <div class="category-color-picker">
                  <span class="color-dot color-1" data-color="1"></span>
                  <span class="color-dot color-2" data-color="2"></span>
                  <span class="color-dot color-3" data-color="3"></span>
                  <span class="color-dot color-4" data-color="4"></span>
                  <span class="color-dot color-5" data-color="5"></span>
                </div>
                <input type="hidden" id="categoryColor" name="categoryColor" value="1">
              </div>
            </div>
            <div class="form-group">
              <button type="submit" id="submitBtn" class="btn-primary">保存备忘录</button>
              <button type="button" id="cancelBtn" style="display:none;" class="btn-secondary">取消编辑</button>
            </div>
            <div id="formStatus" class="status-message"></div>
          </form>
        </div>
      </div>
    </div>
    
    <div class="right-column">
      <div class="card memos-card">
        <div class="card-header">
          <div class="header-title">
            备忘录列表<span class="memo-count" id="memoCount"></span>
          </div>
          <button class="refresh-btn" id="refreshBtn">刷新</button>
        </div>
        <div class="card-body memos-container" style="padding: 0;">
          <div class="memos-list" id="memosList">
            <div class="loading"><div class="spinner"></div> 加载备忘录中...</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const memoForm = document.getElementById('memoForm');
    const memosList = document.getElementById('memosList');
    const memoIdInput = document.getElementById('memoId');
    const titleInput = document.getElementById('title');
    const contentInput = document.getElementById('content');
    const categoryInput = document.getElementById('category');
    const submitBtn = document.getElementById('submitBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const formStatus = document.getElementById('formStatus');
    const memoCount = document.getElementById('memoCount');
    const refreshBtn = document.getElementById('refreshBtn');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const logoUpload = document.getElementById('logoUpload');
    const uploadLogoBtn = document.getElementById('uploadLogoBtn');
    const resetLogoBtn = document.getElementById('resetLogoBtn');
    const previewImage = document.getElementById('previewImage');
    const appLogo = document.getElementById('app-logo');
    const appFavicon = document.getElementById('app-favicon');
    const customTitleInput = document.getElementById('customTitle');
    const appTitle = document.querySelector('h1');
    
    // 分页相关变量
    let currentPage = 1;
    let pageSize = 10;
    let totalMemos = 0;
    let allMemos = [];
    
    // 防止表单重复提交
    let isSubmitting = false;
    const SUBMIT_COOLDOWN = 2000; // 冷却时间 2 秒
    
    // 前端动态安全锁
    let dynamicSecurityLock = {
      uuid: generateClientUUID(),
      expiryTime: Date.now() + 10000, // 10秒有效期
      interval: 10000 // 10秒更新一次
    };
    
    // 生成客户端UUID
    function generateClientUUID() {
      const timestamp = Date.now().toString(36);
      const randomStr = Math.random().toString(36).substring(2, 10);
      return timestamp + '-' + randomStr;
    }
    
    // 更新安全锁
    function updateSecurityLock() {
      dynamicSecurityLock.uuid = generateClientUUID();
      dynamicSecurityLock.expiryTime = Date.now() + dynamicSecurityLock.interval;
      
      // 设置下一次更新
      setTimeout(updateSecurityLock, dynamicSecurityLock.interval);
    }
    
    // 初始化安全锁更新
    updateSecurityLock();
    
    // 默认加密密钥 (可以修改为其他默认值)
    const DEFAULT_ENCRYPTION_KEY = 'memo-secure-key-2023';
    
    // 加密工具函数
    async function encryptData(data, password = DEFAULT_ENCRYPTION_KEY) {
      try {
        // 将密码转换为加密密钥
        const encoder = new TextEncoder();
        const passwordData = encoder.encode(password);
        const keyData = await crypto.subtle.digest('SHA-256', passwordData);
        const key = await crypto.subtle.importKey(
          'raw', 
          keyData, 
          { name: 'AES-GCM' }, 
          false, 
          ['encrypt']
        );
        
        // 创建随机初始化向量
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        // 加密数据
        const jsonString = JSON.stringify(data);
        const plaintext = encoder.encode(jsonString);
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv }, 
          key, 
          plaintext
        );
        
        // 组合IV和密文
        const encryptedData = new Uint8Array(iv.length + ciphertext.byteLength);
        encryptedData.set(iv, 0);
        encryptedData.set(new Uint8Array(ciphertext), iv.length);
        
        // 转换为Base64便于存储
        const encryptedString = Array.from(encryptedData)
          .map(byte => String.fromCharCode(byte))
          .join('');
        return btoa(encryptedString);
      } catch (error) {
        console.error('加密失败:', error);
        throw new Error('加密过程中出错: ' + error.message);
      }
    }
    
    // 解密工具函数
    async function decryptData(encryptedBase64, password = DEFAULT_ENCRYPTION_KEY) {
      try {
        // 将密码转换为解密密钥
        const encoder = new TextEncoder();
        const passwordData = encoder.encode(password);
        const keyData = await crypto.subtle.digest('SHA-256', passwordData);
        const key = await crypto.subtle.importKey(
          'raw', 
          keyData, 
          { name: 'AES-GCM' }, 
          false, 
          ['decrypt']
        );
        
        // 解码Base64
        const encryptedString = atob(encryptedBase64);
        const encryptedData = new Uint8Array(encryptedString.length);
        for (let i = 0; i < encryptedString.length; i++) {
          encryptedData[i] = encryptedString.charCodeAt(i);
        }
        
        // 提取IV和密文
        const iv = encryptedData.slice(0, 12);
        const ciphertext = encryptedData.slice(12);
        
        // 解密数据
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv }, 
          key, 
          ciphertext
        );
        
        // 转换为JSON对象
        const decoder = new TextDecoder();
        const jsonString = decoder.decode(decrypted);
        return JSON.parse(jsonString);
      } catch (error) {
        console.error('解密失败:', error);
        throw new Error('解密失败，请确认密码是否正确或文件是否完整');
      }
    }
    
    // 检查数据是否已加密
    function isEncryptedData(data) {
      // 检查是否为加密字符串格式 (Base64)
      const base64Regex = /^[A-Za-z0-9+/=]+$/;
      if (typeof data === 'string' && base64Regex.test(data)) {
        // 尝试解析为JSON，如果失败，可能是加密数据
        try {
          JSON.parse(data);
          return false; // 可以成功解析为JSON，不是加密数据
        } catch (e) {
          return true; // 不能解析为JSON，可能是加密数据
        }
      }
      return false;
    }
    
    // 获取加密密码
    async function getEncryptionPassword(isEncrypt = true) {
      return new Promise((resolve) => {
        const action = isEncrypt ? '加密' : '解密';
        const password = prompt("请输入" + action + "密码（留空使用默认密码）：");
        resolve(password || DEFAULT_ENCRYPTION_KEY);
      });
    }
    
    // 刷新按钮事件
    refreshBtn.addEventListener('click', loadMemos);
    
    // 导出备份
    exportBtn.addEventListener('click', async function() {
      try {
        // 获取最新数据
        const response = await fetch('/api/memos');
        if (!response.ok) {
          throw new Error('获取数据失败');
        }
        
        const memos = await response.json();
        
        // 创建备份数据
        const backupData = {
          version: '1.0',
          timestamp: Date.now(),
          data: memos
        };
        
        // 询问用户是否加密及获取密码
        const password = await getEncryptionPassword(true);
        let fileContent, fileType, fileName;
        
        // 加密数据
        const encryptedData = await encryptData(backupData, password);
        showStatus('数据已加密', false);
        
        // 创建下载文件
        fileContent = encryptedData;
        fileType = 'text/plain';
        fileName = 'memo-backup-encrypted-' + new Date().toISOString().slice(0, 10) + '.enc';
        
        const blob = new Blob([fileContent], { type: fileType });
        const url = URL.createObjectURL(blob);
        
        // 创建下载链接
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        
        // 清理
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 0);
        
        showStatus('加密备份已导出', false);
      } catch (error) {
        console.error('导出备份失败:', error);
        showStatus('导出备份失败: ' + error.message, true);
      }
    });
    
    // 导入备份
    importBtn.addEventListener('click', function() {
      importFile.click();
    });
    
    // 处理文件选择
    importFile.addEventListener('change', async function(e) {
      if (!this.files || !this.files[0]) return;
      
      const file = this.files[0];
      if (file.size > 10 * 1024 * 1024) { // 限制10MB
        showStatus('文件过大，请选择小于10MB的备份文件', true);
        this.value = '';
        return;
      }
      
      showStatus('正在处理备份文件...', false);
      
      const reader = new FileReader();
      
      reader.onload = async function(e) {
        try {
          console.log('开始解析备份文件');
          let fileContent = e.target.result;
          let backupData;
          
          // 检查文件是否为加密格式
          const isEncrypted = file.name.endsWith('.enc') || isEncryptedData(fileContent);
          
          if (isEncrypted) {
            // 获取解密密码
            const password = await getEncryptionPassword(false);
            
            try {
              // 解密数据
              backupData = await decryptData(fileContent, password);
              showStatus('数据已解密', false);
            } catch (decryptError) {
              throw new Error('解密失败: ' + decryptError.message);
            }
          } else {
            // 尝试解析为JSON
            try {
              backupData = JSON.parse(fileContent);
            } catch (parseError) {
              throw new Error('备份文件不是有效的JSON格式或加密文件: ' + parseError.message);
            }
          }
          
          // 判断备份格式 - 支持两种格式:
          // 1. {version, timestamp, data: [...]} - 标准格式
          // 2. [...] - 直接的备忘录数组
          let memosData;
          
          if (Array.isArray(backupData)) {
            console.log('检测到直接数组格式的备份');
            memosData = backupData;
          } else if (backupData.data && Array.isArray(backupData.data)) {
            console.log('检测到标准备份格式 v' + (backupData.version || '未知'));
            memosData = backupData.data;
          } else {
            throw new Error('备份文件格式无效，无法识别数据结构');
          }
          
          // 验证数据有效性
          if (memosData.length === 0) {
            // 允许导入空备忘录，但显示特殊提示
            if (!confirm('备份文件中不包含任何备忘录数据，导入将清空当前所有数据。确定要继续吗？')) {
              return;
            }
            console.log('用户确认导入空备忘录列表');
          } else {
            // 检查至少有一个有效记录
            const hasValidRecord = memosData.some(memo => 
              memo && typeof memo === 'object' && 
              memo.title && typeof memo.title === 'string' &&
              memo.content && typeof memo.content === 'string'
            );
            
            if (!hasValidRecord) {
              throw new Error('备份中没有有效的备忘录记录');
            }
            
            // 确认导入
            if (!confirm('确定要导入这个包含 ' + memosData.length + ' 条备忘录的备份吗？这将覆盖当前的所有数据。')) {
              return;
            }
          }
          
          // 处理数据过大的问题
          const jsonData = JSON.stringify(memosData);
          if (jsonData.length > 1000000) { // 1MB限制
            console.log('备份数据较大: ' + Math.round(jsonData.length / 1024) + 'KB，将分批上传');
            
            // 这里可以实现分批上传逻辑
            showStatus('备份数据较大，开始上传...', false);
          }
          
          // 保存到localStorage
          try {
            localStorage.setItem('memo_backup', JSON.stringify({
              timestamp: Date.now(),
              data: memosData
            }));
            console.log('已保存到本地存储作为备份');
          } catch (storageError) {
            console.warn('无法保存到localStorage:', storageError);
          }
          
          // 显示处理中状态
          showStatus('正在上传到服务器...', false);
          
          // 保存到服务器
          try {
            console.log('开始上传数据到服务器');
            const response = await fetch('/api/memos/import', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                data: memosData,
                timestamp: Date.now()
              })
            });
            
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || '服务器返回错误: ' + response.status);
            }
            
            const result = await response.json();
            
            console.log('服务器响应:', result);
            
            if (result.success) {
              // 成功导入
              showStatus(result.message || '备份已成功导入', false);
              loadMemos();
            } else {
              throw new Error(result.error || '服务器处理导入失败');
            }
          } catch (fetchError) {
            console.error('上传备份失败:', fetchError);
            
            // 如果服务器导入失败，至少在本地恢复数据
            showStatus('无法保存到服务器: ' + fetchError.message + '，但数据已在本地恢复', true);
            renderMemos(memosData);
          }
        } catch (error) {
          console.error('导入过程中发生错误:', error);
          showStatus('导入失败: ' + error.message, true);
        } finally {
          // 重置文件输入
          importFile.value = '';
        }
      };
      
      reader.onerror = function() {
        showStatus('读取文件失败', true);
        importFile.value = '';
      };
      
      reader.readAsText(file);
    });
    
    // 显示状态消息
    function showStatus(message, isError = false) {
      formStatus.textContent = message;
      formStatus.className = 'status-message ' + (isError ? 'error' : 'success');
      formStatus.style.display = 'block';
      
      setTimeout(() => {
        formStatus.style.display = 'none';
      }, 3000);
    }
    
    // 退出登录
    logoutBtn.addEventListener('click', function() {
      if (confirm('确定要退出登录吗？')) {
        fetch('/api/logout', { 
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
          .then(response => {
            if(response.ok) {
              window.location.href = '/';
            } else {
              showStatus('退出登录失败，请刷新页面重试', true);
            }
          })
          .catch(error => {
            showStatus('退出登录失败: ' + error.message, true);
          });
      }
    });
    
    // 设置模态框相关功能
    function openSettingsModal() {
      settingsModal.classList.add('active');
      document.body.style.overflow = 'hidden'; // 防止背景滚动
    }
    
    function closeModal() {
      settingsModal.classList.remove('active');
      document.body.style.overflow = '';
    }
    
    // 自定义 Logo 功能
    async function handleLogoUpload(e) {
      const file = e.target.files[0];
      if (!file) return;
      
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        showStatus('请选择图片文件', true);
        return;
      }
      
      // 限制文件大小 (500KB)
      if (file.size > 500 * 1024) {
        showStatus('图片过大，请选择小于500KB的图片', true);
        return;
      }
      
      try {
        // 读取文件为 DataURL
        const dataUrl = await readFileAsDataURL(file);
        
        // 更新预览
        previewImage.src = dataUrl;
        
        // 保存到本地存储
        localStorage.setItem('custom_logo', dataUrl);
      } catch (error) {
        showStatus('处理图片失败: ' + error.message, true);
      }
    }
    
    // 读取文件为 DataURL
    function readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
    }
    
    // 重置 Logo 为默认值
    function resetLogo() {
      const defaultLogo = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=';
      previewImage.src = defaultLogo;
      localStorage.removeItem('custom_logo');
    }
    
    // 保存设置
    function saveSettings() {
      // 更新应用 Logo
      appLogo.src = previewImage.src;
      
      // 更新网站图标
      appFavicon.href = previewImage.src;
      
      // 更新系统标题
      const customTitle = customTitleInput.value.trim();
      if (customTitle) {
        appTitle.textContent = customTitle;
        document.title = customTitle;
        localStorage.setItem('custom_title', customTitle);
      } else {
        const defaultTitle = '备忘录管理系统';
        appTitle.textContent = defaultTitle;
        document.title = defaultTitle;
        localStorage.removeItem('custom_title');
      }
      
      closeModal();
      showStatus('设置已保存', false);
    }
    
    // 加载保存的自定义设置
    function loadCustomLogo() {
      // 加载自定义Logo
      const savedLogo = localStorage.getItem('custom_logo');
      if (savedLogo) {
        appLogo.src = savedLogo;
        previewImage.src = savedLogo;
        appFavicon.href = savedLogo;
      }
      
      // 加载自定义标题
      const savedTitle = localStorage.getItem('custom_title');
      if (savedTitle) {
        appTitle.textContent = savedTitle;
        document.title = savedTitle;
        customTitleInput.value = savedTitle;
      }
    }
    
    // 初始化设置按钮和模态框
    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsModal.addEventListener('click', closeModal);
    cancelSettingsBtn.addEventListener('click', closeModal);
    saveSettingsBtn.addEventListener('click', saveSettings);
    
    // 关闭模态框的背景点击事件
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeModal();
      }
    });
    
    // Logo上传功能
    uploadLogoBtn.addEventListener('click', () => {
      logoUpload.click();
    });
    
    logoUpload.addEventListener('change', handleLogoUpload);
    resetLogoBtn.addEventListener('click', resetLogo);
    
    // 标题重置功能
    const resetTitleBtn = document.getElementById('resetTitleBtn');
    resetTitleBtn.addEventListener('click', () => {
      customTitleInput.value = '';
    });
    
    // 加载保存的自定义Logo
    loadCustomLogo();
    
    // 加载备忘录列表
    async function loadMemos() {
      try {
        memosList.innerHTML = '<div class="loading"><div class="spinner"></div> 加载备忘录中...</div>';
        
        try {
          // 获取当前动态锁
          const currentLock = dynamicSecurityLock.uuid;
          
          // 添加动态锁到请求头
          const headers = {
            'X-Dynamic-Lock': currentLock
          };
          
          const response = await fetch('/api/memos', { headers });
          if (response.ok) {
            const memos = await response.json();
            
            // 成功获取服务器数据，保存到localStorage作为备份
            try {
              localStorage.setItem('memo_backup', JSON.stringify({
                timestamp: Date.now(),
                data: memos
              }));
              console.log('已保存备忘录备份到本地存储');
            } catch (localStorageError) {
              console.warn('无法将备份保存到本地存储:', localStorageError);
            }
            
            renderMemos(memos);
            return;
          }
        } catch (fetchError) {
          console.error('从服务器获取备忘录失败:', fetchError);
        }
        
        // 如果从服务器获取失败，尝试从本地存储恢复
        try {
          const backupData = localStorage.getItem('memo_backup');
          if (backupData) {
            const backup = JSON.parse(backupData);
            const backupAge = Date.now() - backup.timestamp;
            const hours = Math.floor(backupAge / (1000 * 60 * 60));
            const minutes = Math.floor((backupAge % (1000 * 60 * 60)) / (1000 * 60));
            
            console.log('从本地备份恢复数据');
            renderMemos(backup.data);
            
            // 显示恢复提示
            showStatus('已从本地备份恢复数据 (备份时间: ' + hours + '小时' + minutes + '分钟前)', false);
            return;
          }
        } catch (restoreError) {
          console.error('恢复本地备份失败:', restoreError);
        }
        
        // 如果所有方法都失败，显示错误
        throw new Error('无法从服务器和本地备份中获取数据');
      } catch (error) {
        console.error('加载备忘录失败:', error);
        memosList.innerHTML = '<div class="empty-state"><svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg><div class="empty-state-text">暂无备忘录</div></div>';
      }
    }
    
    // 渲染备忘录列表
    function renderMemos(memos = []) {
      if (!Array.isArray(memos)) {
        memosList.innerHTML = '<div class="empty-state"><svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg><div class="empty-state-text">加载备忘录失败: 服务器返回无效数据</div><button onclick="loadMemos()" class="btn-primary">重试</button></div>';
        return;
      }
      
      // 更新备忘录计数和全局变量
      totalMemos = memos.length;
      allMemos = memos;
      memoCount.textContent = ' (' + totalMemos + '条)';
      
      if (totalMemos === 0) {
        memosList.innerHTML = '<div class="empty-state"><svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg><div class="empty-state-text">暂无备忘录</div></div>';
        return;
      }
      
      // 计算分页
      const totalPages = Math.ceil(totalMemos / pageSize);
      if (currentPage > totalPages) {
        currentPage = totalPages;
      }
      
      // 获取当前页的备忘录
      const start = (currentPage - 1) * pageSize;
      const end = Math.min(start + pageSize, totalMemos);
      const currentPageMemos = memos.slice(start, end);
      
      let content = '';
      currentPageMemos.forEach(memo => {
        const memoDate = new Date(memo.createdAt).toLocaleString('zh-CN');
        const category = memo.category || '其他';
        const colorClass = memo.categoryColor ? 'category-color-' + memo.categoryColor : 'category-color-5';
        const colorValue = memo.categoryColor || '5';
        
        content += '<div class="memo-item" data-color="' + colorValue + '">' +
          '<div class="bubble-bg"></div>' + // 添加气泡背景容器
          '<div class="memo-header">' +
            '<h3 class="memo-title">' + memo.title + '</h3>' +
            '<div class="memo-category ' + colorClass + '">' + category + '</div>' +
          '</div>' +
          '<div class="memo-content">' + memo.content + '</div>' +
          '<div class="memo-footer">' +
            '<div class="memo-date">创建时间: ' + memoDate + '</div>' +
            '<div class="memo-actions">' +
              '<button class="btn-sm btn-edit edit-btn" data-id="' + memo.id + '">编辑</button>' +
              '<button class="btn-sm btn-delete delete-btn" data-id="' + memo.id + '">删除</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      
      // 添加分页控件
      const paginationContent = createPaginationControls(currentPage, totalPages, totalMemos);
      content += paginationContent;
      
      memosList.innerHTML = content;
      
      // 添加编辑按钮事件
      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          editMemo(this.dataset.id);
        });
      });
      
      // 添加删除按钮事件
      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          deleteMemo(this.dataset.id);
        });
      });
      
      // 设置分页事件
      setupPaginationEvents();
      
      // 初始化气泡背景
      initBubbleBackgrounds();
      
      // 确保所有卡片具有一致的高度
      setTimeout(() => {
        equalizeCardHeights();
      }, 50);
    }
    
    // 新增函数：统一卡片高度
    function equalizeCardHeights() {
      const memoItems = document.querySelectorAll('.memo-item');
      if (!memoItems || memoItems.length === 0) return;
      
      // 如果是移动设备视图，不需要统一高度，允许自然流动布局
      if (window.innerWidth < 768) {
        // 重置所有卡片高度为自动，以便在移动设备上恢复自然流动布局
        memoItems.forEach(item => {
          item.style.height = 'auto';
        });
        return;
      }
      
      // 重置所有卡片高度，以便重新计算
      memoItems.forEach(item => {
        item.style.height = 'auto';
      });
      
      // 找出最大的自然高度
      let maxHeight = 0;
      memoItems.forEach(item => {
        const height = item.offsetHeight;
        if (height > maxHeight) {
          maxHeight = height;
        }
      });
      
      // 确保最小高度至少220px
      maxHeight = Math.max(maxHeight, 220);
      
      // 应用统一高度到所有卡片
      memoItems.forEach(item => {
        item.style.height = maxHeight + 'px';
      });
      
      console.log('统一卡片高度为: ' + maxHeight + 'px');
    }
    
    // 初始化气泡背景
    function initBubbleBackgrounds() {
      document.querySelectorAll('.bubble-bg').forEach(container => {
        // 清空现有气泡
        container.innerHTML = '';
        
        // 根据卡片颜色决定气泡主色调
        const colorValue = container.closest('.memo-item').getAttribute('data-color');
        const colorMap = {
          '1': 'primary',
          '2': 'secondary',
          '3': 'danger',
          '4': 'success',
          '5': 'gray'
        };
        const mainColor = colorMap[colorValue] || 'primary';
        
        // 生成5-10个随机气泡
        const bubbleCount = 5 + Math.floor(Math.random() * 6);
        for (let i = 0; i < bubbleCount; i++) {
          createBubble(container, mainColor);
        }
      });
    }
    
    // 创建单个气泡
    function createBubble(container, mainColor) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      
      // 随机尺寸 (10-30px)
      const size = 10 + Math.random() * 20;
      bubble.style.width = size + 'px';
      bubble.style.height = size + 'px';
      
      // 随机位置
      bubble.style.bottom = Math.random() * 100 + '%';
      bubble.style.left = Math.random() * 100 + '%';
      
      // 随机动画持续时间 (3-7秒)
      const duration = 3 + Math.random() * 4;
      bubble.style.animationDuration = duration + 's';
      
      // 随机延迟 (0-5秒)
      const delay = Math.random() * 5;
      bubble.style.animationDelay = delay + 's';
      
      // 随机颜色 (偏向主色调)
      const colorChoices = ['primary', 'secondary', 'danger', 'success', 'gray'];
      const useMainColor = Math.random() < 0.6; // 60%概率使用主色调
      const colorClass = useMainColor ? mainColor : colorChoices[Math.floor(Math.random() * colorChoices.length)];
      bubble.classList.add(colorClass);
      
      container.appendChild(bubble);
    }
    
    // 创建分页控件
    function createPaginationControls(current, total, itemCount) {
      if (total <= 1) return '';
      
      let html = '<div class="pagination">';
      
      // 分页信息
      html += '<div class="pagination-info">';
      const start = (current - 1) * pageSize + 1;
      const end = Math.min(current * pageSize, itemCount);
      html += '显示 ' + start + ' - ' + end + ' 条，共 ' + itemCount + ' 条';
      html += '</div>';
      
      // 分页控件
      html += '<div class="pagination-controls">';
      
      // 上一页按钮
      html += '<button class="page-btn page-nav" ' + (current === 1 ? 'disabled' : 'data-page="' + (current - 1) + '"') + '>';
      html += '上一页</button>';
      
      // 页码按钮
      const maxVisiblePages = window.innerWidth < 640 ? 3 : 5; // 在移动设备上减少显示的页码数量
      let startPage = Math.max(1, current - Math.floor(maxVisiblePages / 2));
      let endPage = Math.min(total, startPage + maxVisiblePages - 1);
      
      if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
      
      if (startPage > 1) {
        html += '<button class="page-btn" data-page="1">1</button>';
        if (startPage > 2) {
          html += '<span class="pagination-dots">...</span>';
        }
      }
      
      for (let i = startPage; i <= endPage; i++) {
        html += '<button class="page-btn ' + (i === current ? 'active' : '') + '" data-page="' + i + '">' + i + '</button>';
      }
      
      if (endPage < total) {
        if (endPage < total - 1) {
          html += '<span class="pagination-dots">...</span>';
        }
        html += '<button class="page-btn" data-page="' + total + '">' + total + '</button>';
      }
      
      // 下一页按钮
      html += '<button class="page-btn page-nav" ' + (current === total ? 'disabled' : 'data-page="' + (current + 1) + '"') + '>';
      html += '下一页</button>';
      
      // 添加页面大小选择
      html += '<div class="page-size-control">';
      html += '<span class="page-size-label">每页</span>';
      html += '<select id="pageSizeSelect" class="page-size-select">';
      // 移动设备上减少选项
      const pageSizes = window.innerWidth < 640 ? [5, 10, 20] : [5, 10, 20, 50];
      pageSizes.forEach(size => {
        html += '<option value="' + size + '"' + (pageSize === size ? ' selected' : '') + '>' + size + '</option>';
      });
      html += '</select>';
      html += '<span class="page-size-label">条</span>';
      html += '</div>';
      
      html += '</div></div>';
      
      return html;
    }
    
    // 切换页面
    function changePage(page) {
      if (page < 1 || page > Math.ceil(totalMemos / pageSize)) return;
      
      currentPage = page;
      
      // 添加加载状态
      const memoListContainer = document.querySelector('.memos-list');
      if (memoListContainer) {
        memoListContainer.classList.add('loading');
        
        // 延迟渲染以允许加载状态显示
        setTimeout(() => {
          renderMemos(allMemos);
          memoListContainer.classList.remove('loading');
          
          // 滚动到列表顶部
          memoListContainer.scrollTop = 0;
          // 对于页面滚动，需要滚动到备忘录列表的顶部
          memoListContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        renderMemos(allMemos);
      }
    }
    
    // 提交表单
    memoForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      // 防止重复提交
      if (isSubmitting) {
        showStatus('请勿频繁提交', true);
        return;
      }
      
      const formData = {
        title: titleInput.value.trim(),
        content: contentInput.value.trim(),
        category: categoryInput.value.trim() || '其他',
        categoryColor: categoryColorInput.value
      };
      
      if (!formData.title || !formData.content) {
        showStatus('请填写标题和内容', true);
        return;
      }
      
      // 设置提交状态
      isSubmitting = true;
      setTimeout(() => { isSubmitting = false; }, SUBMIT_COOLDOWN);
      
      // 禁用表单
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<div class="spinner" style="margin:0;width:14px;height:14px;"></div> 处理中...';
      cancelBtn.disabled = true;
      
      try {
        let url = '/api/memos';
        let method = 'POST';
        
        if (memoIdInput.value) {
          url = '/api/memos/' + memoIdInput.value;
          method = 'PUT';
          formData.id = memoIdInput.value;
        }
        
        // 获取当前动态锁
        const currentLock = dynamicSecurityLock.uuid;
        
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Dynamic-Lock': currentLock
          },
          body: JSON.stringify(formData)
        });
        
        if (!response.ok) {
          throw new Error('服务器响应错误: ' + response.status);
        }
        
        const result = await response.json();
        
        memoForm.reset();
        memoIdInput.value = '';
        submitBtn.textContent = '保存备忘录';
        cancelBtn.style.display = 'none';
        showStatus(memoIdInput.value ? '备忘录已更新' : '备忘录已创建');
        
        // 重新加载备忘录列表
        loadMemos();
      } catch (error) {
        console.error('保存备忘录失败:', error);
        showStatus('保存备忘录失败: ' + error.message, true);
      } finally {
        // 恢复表单
        submitBtn.disabled = false;
        submitBtn.textContent = '保存备忘录';
        cancelBtn.disabled = false;
      }
    });
    
    // 编辑备忘录
    async function editMemo(id) {
      try {
        // 获取当前动态锁
        const currentLock = dynamicSecurityLock.uuid;
        
        const response = await fetch('/api/memos/' + id, {
          headers: {
            'X-Dynamic-Lock': currentLock
          }
        });
        if (!response.ok) {
          throw new Error('服务器响应错误: ' + response.status);
        }
        
        const memo = await response.json();
        memoIdInput.value = memo.id;
        titleInput.value = memo.title;
        contentInput.value = memo.content;
        categoryInput.value = memo.category || '其他';
        
        // 设置分类颜色
        const colorValue = memo.categoryColor || '1';
        categoryColorInput.value = colorValue;
        
        // 更新颜色选择器UI状态
        colorDots.forEach(dot => dot.classList.remove('selected'));
        document.querySelector('.color-dot[data-color="' + colorValue + '"]').classList.add('selected');
        
        submitBtn.textContent = '更新备忘录';
        cancelBtn.style.display = 'inline-block';
        
        // 如果是移动设备，滚动到表单
        if (window.innerWidth <= 768) {
          window.scrollTo({
            top: 0,
            behavior: 'smooth'
          });
        }
        
        // 聚焦标题输入框
        titleInput.focus();
      } catch (error) {
        console.error('编辑备忘录失败:', error);
        showStatus('获取备忘录详情失败: ' + error.message, true);
      }
    }
    
    // 删除备忘录
    async function deleteMemo(id) {
      if (!confirm('确定要删除这条备忘录吗？')) {
        return;
      }
      
      try {
        // 获取当前动态锁
        const currentLock = dynamicSecurityLock.uuid;
        
        const response = await fetch('/api/memos/' + id, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-Dynamic-Lock': currentLock
          }
        });
        
        if (!response.ok) {
          throw new Error('服务器响应错误: ' + response.status);
        }
        
        showStatus('备忘录已删除');
        loadMemos();
      } catch (error) {
        console.error('删除备忘录失败:', error);
        showStatus('删除备忘录失败: ' + error.message, true);
      }
    }
    
    // 取消编辑
    cancelBtn.addEventListener('click', function() {
      memoForm.reset();
      memoIdInput.value = '';
      submitBtn.textContent = '保存备忘录';
      cancelBtn.style.display = 'none';
      
      // 重置分类颜色选择器
      categoryColorInput.value = '1';
      colorDots.forEach(dot => dot.classList.remove('selected'));
      document.querySelector('.color-dot[data-color="1"]').classList.add('selected');
    });
    
    // 显示错误信息
    function showError(message) {
      showStatus(message, true);
    }
    
    // 初始化分类颜色选择器
    const categoryColorInput = document.getElementById('categoryColor');
    const colorDots = document.querySelectorAll('.color-dot');
    
    // 设置初始选中颜色
    document.querySelector('.color-dot[data-color="1"]').classList.add('selected');
    
    // 颜色点击事件
    colorDots.forEach(dot => {
      dot.addEventListener('click', function() {
        // 移除所有选中状态
        colorDots.forEach(d => d.classList.remove('selected'));
        // 添加当前选中状态
        this.classList.add('selected');
        // 更新隐藏输入值
        categoryColorInput.value = this.getAttribute('data-color');
      });
    });
    
    // 加载现有分类并填充建议列表
    async function loadCategories() {
      try {
        // 获取当前动态锁
        const currentLock = dynamicSecurityLock.uuid;
        
        const response = await fetch('/api/memos', {
          headers: {
            'X-Dynamic-Lock': currentLock
          }
        });
        if (response.ok) {
          const memos = await response.json();
          if (Array.isArray(memos)) {
            // 提取所有唯一分类
            const uniqueCategories = [...new Set(memos.map(memo => memo.category).filter(Boolean))];
            
            // 获取datalist元素
            const datalist = document.getElementById('category-suggestions');
            
            // 清空现有选项
            datalist.innerHTML = '';
            
            // 添加默认选项
            const defaultCategories = ['工作', '个人', '重要', '想法', '其他'];
            
            // 合并默认和已使用的分类，去重
            const allCategories = [...new Set([...defaultCategories, ...uniqueCategories])];
            
            // 添加到datalist
            allCategories.forEach(category => {
              const option = document.createElement('option');
              option.value = category;
              datalist.appendChild(option);
            });
          }
        }
      } catch (error) {
        console.error('加载分类失败:', error);
      }
    }
    
    // 页面加载时获取备忘录列表以及初始化分类
    document.addEventListener('DOMContentLoaded', () => {
      loadMemos();
      loadCategories();
      
      // 添加窗口大小变化监听，以便在调整窗口大小时重新计算卡片高度
      window.addEventListener('resize', debounce(equalizeCardHeights, 150));
    });
    
    // 添加分页按钮事件
    function setupPaginationEvents() {
      // 添加分页按钮事件
      document.querySelectorAll('.page-btn').forEach(btn => {
        if (btn.dataset.page) {
          btn.addEventListener('click', function() {
            if (!this.disabled) {
              // 添加点击反馈效果
              this.classList.add('clicked');
              setTimeout(() => {
                this.classList.remove('clicked');
                
                // 根据当前是否在搜索模式下选择相应的翻页函数
                if (isInSearchMode) {
                  changeSearchPage(parseInt(this.dataset.page));
                } else {
                  changePage(parseInt(this.dataset.page));
                }
              }, 150);
            }
          });
        }
      });
      
      // 添加页面大小选择事件
      const pageSizeSelect = document.getElementById('pageSizeSelect');
      if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', function() {
          pageSize = parseInt(this.value);
          currentPage = 1; // 重置为第一页
          
          // 根据当前是否在搜索模式下选择相应的渲染函数
          if (isInSearchMode) {
            renderSearchResults(searchResultMemos); // 使用搜索结果重新渲染
          } else {
            renderMemos(allMemos); // 重新渲染
          }
        });
      }
      
      // 如果是搜索结果页面，添加清除搜索按钮事件
      const clearSearchBtn = document.getElementById('clearSearchBtn');
      if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
          clearSearch();
        });
      }
    }
    
    // 切换页面
    function changePage(page) {
      if (page < 1) return;
      
      // 确保page不超过最大页码
      if (isInSearchMode) {
        if (page > Math.ceil(searchResultMemos.length / pageSize)) return;
      } else {
        if (page > Math.ceil(allMemos.length / pageSize)) return;
      }
      
      currentPage = page;
      
      // 添加加载状态
      const memoListContainer = document.querySelector('.memos-list');
      if (memoListContainer) {
        memoListContainer.classList.add('loading');
        
        // 延迟渲染以允许加载状态显示
        setTimeout(() => {
          if (isInSearchMode) {
            renderSearchResults(searchResultMemos);
          } else {
            renderMemos(allMemos);
          }
          memoListContainer.classList.remove('loading');
          
          // 滚动到列表顶部
          memoListContainer.scrollTop = 0;
          // 对于页面滚动，需要滚动到备忘录列表的顶部
          memoListContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        if (isInSearchMode) {
          renderSearchResults(searchResultMemos);
        } else {
          renderMemos(allMemos);
        }
      }
    }
    
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    // 定义全局变量
    let isInSearchMode = false;
    let searchResultMemos = [];

    function searchMemos(query) {
      try {
        if (!query || !query.trim || typeof query.trim !== 'function') {
          console.error('无效的搜索查询:', query);
          isInSearchMode = false;
          searchResultMemos = [];
          renderMemos(allMemos);
          memoCount.textContent = ' (' + allMemos.length + '条)';
          return;
        }
        
        query = query.trim();
        if (!query) {
          // 如果搜索框为空，显示所有备忘录
          isInSearchMode = false;
          searchResultMemos = [];
          renderMemos(allMemos);
          memoCount.textContent = ' (' + allMemos.length + '条)';
          return;
        }
        
        // 检查全局变量存在性
        if (!Array.isArray(allMemos)) {
          console.error('allMemos不是有效数组');
          return;
        }
        
        // 保存原始数据的副本，以便搜索后恢复
        const originalAllMemos = [...allMemos];
        
        // 将搜索词转为小写以便不区分大小写
        const searchTerm = query.toLowerCase();
        
        // 将搜索词拆分为多个关键词（按空格或逗号拆分）
        const keywords = searchTerm.split(/[\s,，]+/).filter(keyword => keyword && keyword.trim && keyword.trim() !== '');
        
        // 搜索备忘录
        const filteredMemos = originalAllMemos.filter(memo => {
          // 确保memo对象存在且包含必要的属性
          if (!memo || typeof memo !== 'object') return false;
          
          // 提取备忘录的可搜索内容
          const titleLower = memo.title ? memo.title.toLowerCase() : '';
          const contentLower = memo.content ? memo.content.toLowerCase() : '';
          const categoryLower = memo.category ? memo.category.toLowerCase() : '';
          const searchableText = titleLower + ' ' + contentLower + ' ' + categoryLower;
          
          // 如果没有关键词，直接返回false
          if (keywords.length === 0) return false;
          
          // 计算匹配的关键词数量
          let matchCount = 0;
          
          // 检查每个关键词
          for (let i = 0; i < keywords.length; i++) {
            const keyword = keywords[i];
            if (!keyword) continue;
            
            if (keyword.length < 2) {
              // 对于单字符关键词，使用完全匹配
              if (searchableText.includes(keyword)) {
                matchCount++;
              }
            } else {
              // 对于多字符关键词，使用包含匹配
              if (titleLower.includes(keyword) || 
                  contentLower.includes(keyword) || 
                  categoryLower.includes(keyword)) {
                matchCount++;
              }
            }
          }
          
          // 返回是否匹配（至少匹配一个关键词）
          return matchCount > 0;
        });
        
        // 按照匹配度排序（通过计算每个备忘录与搜索词的相关性分数）
        const scoredMemos = filteredMemos.map(memo => {
          let score = 0;
          const titleLower = memo.title ? memo.title.toLowerCase() : '';
          const contentLower = memo.content ? memo.content.toLowerCase() : '';
          const categoryLower = memo.category ? memo.category.toLowerCase() : '';
          
          // 计算每个关键词的匹配分数
          for (let i = 0; i < keywords.length; i++) {
            const keyword = keywords[i];
            if (!keyword) continue;
            
            // 标题匹配权重更高
            if (titleLower.includes(keyword)) {
              score += 10; // 标题权重
              // 如果是标题开头的精确匹配，额外加分
              if (titleLower.startsWith(keyword)) {
                score += 5;
              }
            }
            
            // 内容匹配
            if (contentLower.includes(keyword)) {
              score += 5; // 内容权重
            }
            
            // 分类匹配
            if (categoryLower === keyword) { // 精确匹配分类
              score += 8;
            } else if (categoryLower.includes(keyword)) {
              score += 3;
            }
          }
          
          return { memo: memo, score: score };
        });
        
        // 按分数降序排序
        scoredMemos.sort((a, b) => b.score - a.score);
        
        // 提取排序后的备忘录列表
        const sortedMemos = scoredMemos.map(item => item.memo);
        
        // 设置搜索模式并保存搜索结果
        isInSearchMode = true;
        searchResultMemos = sortedMemos;
        
        // 重置当前页为第一页，确保搜索结果从第一页开始显示
        currentPage = 1;
        
        // 使用特殊渲染方法，不更新全局allMemos，但使用搜索结果进行渲染
        renderSearchResults(searchResultMemos);
        
        // 更新备忘录计数
        if (memoCount) {
          memoCount.textContent = ' (' + searchResultMemos.length + '条)';
        }
        
        // 显示搜索结果提示
        if (searchResultMemos.length === 0) {
          showStatus('没有找到匹配的备忘录', true);
          // 显示空状态
          memosList.innerHTML = '<div class="empty-state"><svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg><div class="empty-state-text">没有找到匹配的备忘录</div></div>';
        } else {
          showStatus('找到 ' + searchResultMemos.length + ' 条匹配的备忘录', false);
        }
        
        // 调试信息
        console.log('搜索词:', searchTerm);
        console.log('关键词:', keywords);
        console.log('搜索结果数量:', searchResultMemos.length);
        console.log('所有备忘录数量:', originalAllMemos.length);
      } catch (error) {
        console.error('搜索失败:', error);
        // 发生错误时显示所有备忘录
        try {
          renderMemos(allMemos);
          showStatus('搜索过程中发生错误: ' + error.message, true);
        } catch (e) {
          console.error('恢复显示所有备忘录失败:', e);
        }
      }
    }
    
    // 确保DOM元素已经存在
    if (searchBtn && searchInput) {
      // 搜索按钮点击事件
      searchBtn.addEventListener('click', function() {
        searchMemos(searchInput.value);
      });
      
      // 搜索框回车事件
      searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          searchMemos(this.value);
        }
      });
      
      // 搜索框输入事件（实时搜索）
      searchInput.addEventListener('input', function() {
        // 使用防抖函数避免频繁搜索
        if (this.searchTimeout) {
          clearTimeout(this.searchTimeout);
        }
        this.searchTimeout = setTimeout(() => {
          searchMemos(this.value);
        }, 300);
      });
    } else {
      console.error('搜索相关DOM元素未找到');
    }
    
    // 清除搜索
    function clearSearch() {
      searchInput.value = '';
      renderMemos(allMemos);
    }
    
    // 防抖函数，避免频繁调用
    function debounce(func, wait) {
      let timeout;
      return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          func.apply(context, args);
        }, wait);
      };
    }
    
    // 专门用于渲染搜索结果的函数，不改变全局allMemos
    function renderSearchResults(memos = []) {
      if (!Array.isArray(memos)) {
        memosList.innerHTML = '<div class="empty-state"><svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg><div class="empty-state-text">搜索结果无效</div></div>';
        return;
      }
      
      // 更新总备忘录数量，但不更新全局allMemos
      totalMemos = memos.length;
      memoCount.textContent = ' (' + totalMemos + '条)';
      
      if (totalMemos === 0) {
        memosList.innerHTML = '<div class="empty-state"><svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg><div class="empty-state-text">暂无匹配的备忘录</div></div>';
        return;
      }
      
      // 计算分页
      const totalPages = Math.ceil(totalMemos / pageSize);
      if (currentPage > totalPages) {
        currentPage = totalPages;
      }
      
      // 获取当前页的备忘录
      const start = (currentPage - 1) * pageSize;
      const end = Math.min(start + pageSize, totalMemos);
      const currentPageMemos = memos.slice(start, end);
      
      let content = '';
      currentPageMemos.forEach(memo => {
        const memoDate = new Date(memo.createdAt).toLocaleString('zh-CN');
        const category = memo.category || '其他';
        const colorClass = memo.categoryColor ? 'category-color-' + memo.categoryColor : 'category-color-5';
        const colorValue = memo.categoryColor || '5';
        
        content += '<div class="memo-item" data-color="' + colorValue + '">' +
          '<div class="bubble-bg"></div>' +
          '<div class="memo-header">' +
            '<h3 class="memo-title">' + memo.title + '</h3>' +
            '<div class="memo-category ' + colorClass + '">' + category + '</div>' +
          '</div>' +
          '<div class="memo-content">' + memo.content + '</div>' +
          '<div class="memo-footer">' +
            '<div class="memo-date">创建时间: ' + memoDate + '</div>' +
            '<div class="memo-actions">' +
              '<button class="btn-sm btn-edit edit-btn" data-id="' + memo.id + '">编辑</button>' +
              '<button class="btn-sm btn-delete delete-btn" data-id="' + memo.id + '">删除</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      
      // 添加分页控件及搜索状态信息
      const paginationContent = createPaginationControls(currentPage, totalPages, totalMemos, true);
      content += paginationContent;
      
      memosList.innerHTML = content;
      
      // 添加清除搜索按钮事件
      const clearSearchBtn = document.getElementById('clearSearchBtn');
      if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
          clearSearch();
        });
      }
      
      // 添加编辑按钮事件
      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          editMemo(this.dataset.id);
        });
      });
      
      // 添加删除按钮事件
      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          deleteMemo(this.dataset.id);
        });
      });
      
      // 设置特殊的分页事件处理，用于搜索结果
      setupSearchPaginationEvents();
      
      // 初始化气泡背景
      initBubbleBackgrounds();
      
      // 确保所有卡片具有一致的高度
      setTimeout(() => {
        equalizeCardHeights();
      }, 50);
    }
    
    // 清除搜索
    function clearSearch() {
      searchInput.value = '';
      isInSearchMode = false;
      searchResultMemos = [];
      currentPage = 1; // 重置为第一页
      renderMemos(allMemos);
      showStatus('已清除搜索结果', false);
    }
    
    // 特殊的分页事件处理，用于搜索结果
    function setupSearchPaginationEvents() {
      // 添加分页按钮事件
      document.querySelectorAll('.page-btn').forEach(btn => {
        if (btn.dataset.page) {
          btn.addEventListener('click', function() {
            if (!this.disabled) {
              // 添加点击反馈效果
              this.classList.add('clicked');
              setTimeout(() => {
                this.classList.remove('clicked');
                // 使用搜索结果翻页
                changeSearchPage(parseInt(this.dataset.page));
              }, 150);
            }
          });
        }
      });
      
      // 添加页面大小选择事件
      const pageSizeSelect = document.getElementById('pageSizeSelect');
      if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', function() {
          pageSize = parseInt(this.value);
          currentPage = 1; // 重置为第一页
          renderSearchResults(searchResultMemos); // 使用搜索结果重新渲染
        });
      }
    }
    
    // 切换搜索结果页面
    function changeSearchPage(page) {
      if (page < 1 || page > Math.ceil(searchResultMemos.length / pageSize)) return;
      
      currentPage = page;
      
      // 添加加载状态
      const memoListContainer = document.querySelector('.memos-list');
      if (memoListContainer) {
        memoListContainer.classList.add('loading');
        
        // 延迟渲染以允许加载状态显示
        setTimeout(() => {
          renderSearchResults(searchResultMemos);
          memoListContainer.classList.remove('loading');
          
          // 滚动到列表顶部
          memoListContainer.scrollTop = 0;
          // 对于页面滚动，需要滚动到备忘录列表的顶部
          memoListContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        renderSearchResults(searchResultMemos);
      }
    }
    
    // 修改原有的创建分页控件函数，添加搜索模式参数
    function createPaginationControls(current, total, itemCount, isSearchMode = false) {
      if (total <= 1) return '';
      
      let html = '<div class="pagination">';
      
      // 分页信息
      html += '<div class="pagination-info">';
      const start = (current - 1) * pageSize + 1;
      const end = Math.min(current * pageSize, itemCount);
      
      // 如果是搜索模式，添加搜索指示器
      if (isSearchMode) {
        html += '<span class="search-result-indicator">搜索结果</span> ';
      }
      
      html += '显示 ' + start + ' - ' + end + ' 条，共 ' + itemCount + ' 条';
      
      // 如果是搜索模式，添加返回全部按钮
      if (isSearchMode) {
        html += ' <button id="clearSearchBtn" class="search-clear-btn">返回全部</button>';
      }
      
      html += '</div>';
      
      // 分页控件
      html += '<div class="pagination-controls">';
      
      // 上一页按钮
      html += '<button class="page-btn page-nav" ' + (current === 1 ? 'disabled' : 'data-page="' + (current - 1) + '"') + '>';
      html += '上一页</button>';
      
      // 页码按钮
      const maxVisiblePages = window.innerWidth < 640 ? 3 : 5; // 在移动设备上减少显示的页码数量
      let startPage = Math.max(1, current - Math.floor(maxVisiblePages / 2));
      let endPage = Math.min(total, startPage + maxVisiblePages - 1);
      
      if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
      
      if (startPage > 1) {
        html += '<button class="page-btn" data-page="1">1</button>';
        if (startPage > 2) {
          html += '<span class="pagination-dots">...</span>';
        }
      }
      
      for (let i = startPage; i <= endPage; i++) {
        html += '<button class="page-btn ' + (i === current ? 'active' : '') + '" data-page="' + i + '">' + i + '</button>';
      }
      
      if (endPage < total) {
        if (endPage < total - 1) {
          html += '<span class="pagination-dots">...</span>';
        }
        html += '<button class="page-btn" data-page="' + total + '">' + total + '</button>';
      }
      
      // 下一页按钮
      html += '<button class="page-btn page-nav" ' + (current === total ? 'disabled' : 'data-page="' + (current + 1) + '"') + '>';
      html += '下一页</button>';
      
      // 添加页面大小选择
      html += '<div class="page-size-control">';
      html += '<span class="page-size-label">每页</span>';
      html += '<select id="pageSizeSelect" class="page-size-select">';
      // 移动设备上减少选项
      const pageSizes = window.innerWidth < 640 ? [5, 10, 20] : [5, 10, 20, 50];
      pageSizes.forEach(size => {
        html += '<option value="' + size + '"' + (pageSize === size ? ' selected' : '') + '>' + size + '</option>';
      });
      html += '</select>';
      html += '<span class="page-size-label">条</span>';
      html += '</div>';
      
      html += '</div></div>';
      
      return html;
    }
  </script>
</body>
</html>
`;

// HTML模板 - 登录页面
const loginHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>备忘录系统 - 登录</title>
  <link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=" type="image/svg+xml" id="login-favicon">
  <style>
    /* 公共安全验证标识样式 */
    .public-security-verification {
      position: absolute;
      bottom: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      margin-top: 20px;
      width: 100%;
      display: flex;
      justify-content: center;
    }
    
    .security-badge {
      display: flex;
      align-items: center;
      background: linear-gradient(to right, #f3f4f6, #ffffff);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 8px;
      padding: 8px 12px;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.08);
      max-width: 220px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    
    .security-badge:hover {
      transform: translateY(-2px);
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12);
    }
    
    .badge-icon {
      color: #10b981;
      margin-right: 10px;
      flex-shrink: 0;
    }
    
    .badge-icon svg {
      width: 24px;
      height: 24px;
      stroke: currentColor;
      fill: rgba(16, 185, 129, 0.1);
    }
    
    .badge-text {
      display: flex;
      flex-direction: column;
    }
    
    .badge-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
      margin-bottom: 2px;
    }
    
    .badge-info {
      font-size: 0.65rem;
      color: #6b7280;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    body {
      background-color: #f5f5f5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .login-container {
      background-color: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      width: 100%;
      max-width: 400px;
      padding: 30px;
    }
    h1 {
      text-align: center;
      margin-bottom: 30px;
      color: #333;
    }
    .login-logo-container {
      display: flex;
      justify-content: center;
      margin-bottom: 20px;
    }
    
    .simple-login-logo {
      width: 60px;
      height: 60px;
      object-fit: contain;
      border-radius: 12px;
      box-shadow: 0 3px 6px rgba(0, 0, 0, 0.15);
      background-color: white;
      padding: 5px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    
    .simple-login-logo:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    
    p {
      text-align: center;
      margin-bottom: 20px;
      color: #666;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: bold;
    }
    input {
      width: 100%;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 16px;
    }
    button {
      width: 100%;
      padding: 12px;
      background-color: #0070f3;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 16px;
      cursor: pointer;
      margin-bottom: 10px;
    }
    button:hover {
      background-color: #0051cc;
    }
    .tabs {
      display: flex;
      margin-bottom: 20px;
    }
    .tab {
      flex: 1;
      text-align: center;
      padding: 10px;
      cursor: pointer;
      color: #666;
    }
    .tab.active {
      color: #0070f3;
      border-bottom: 2px solid #0070f3;
      font-weight: bold;
    }
    .login-form {
      display: none;
    }
    .login-form.active {
      display: block;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-logo-container">
      <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=" class="simple-login-logo" id="simple-login-logo" alt="备忘录系统">
    </div>
    <h1>备忘录系统</h1>
    <p>您需要登录后才能访问备忘录管理系统</p>
    
    <div class="tabs">
      <div class="tab active" id="passwordTab">密码登录</div>
      <div class="tab" id="uuidTab">访问密钥登录</div>
    </div>
    
    <div class="login-form active" id="passwordForm">
      <div class="form-group">
        <label for="password">管理密码</label>
        <input type="password" id="password" placeholder="请输入管理密码">
      </div>
      <button id="passwordLoginBtn">登录系统</button>
    </div>
    
    <div class="login-form" id="uuidForm">
      <div class="form-group">
        <label for="uuid">访问密钥</label>
        <input type="text" id="uuid" placeholder="请输入访问密钥">
      </div>
      <button id="uuidLoginBtn">登录系统</button>
    </div>
    
    <!-- 公共安全验证标识 -->
    <div style="margin-top: 20px; text-align: center;">
      <div class="security-badge" style="display: inline-flex; margin: 0 auto;">
        <div class="badge-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
        </div>
        <div class="badge-text">
          <div class="badge-title">公共安全可信应用</div>
          <div class="badge-info">已通过安全认证 · <span id="simple-current-year">2025</span></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // 切换登录方式
    const passwordTab = document.getElementById('passwordTab');
    const uuidTab = document.getElementById('uuidTab');
    const passwordForm = document.getElementById('passwordForm');
    const uuidForm = document.getElementById('uuidForm');
    
    passwordTab.addEventListener('click', function() {
      passwordTab.classList.add('active');
      uuidTab.classList.remove('active');
      passwordForm.classList.add('active');
      uuidForm.classList.remove('active');
    });
    
    uuidTab.addEventListener('click', function() {
      uuidTab.classList.add('active');
      passwordTab.classList.remove('active');
      uuidForm.classList.add('active');
      passwordForm.classList.remove('active');
    });
    
    // 密码登录
    document.getElementById('passwordLoginBtn').addEventListener('click', function() {
      const password = document.getElementById('password').value.trim();
      if (!password) {
        alert('请输入管理密码');
        return;
      }
      
      fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          window.location.href = '/';
        } else {
          alert('密码错误，请重试');
        }
      })
      .catch(() => {
        alert('登录失败，请重试');
      });
    });
    
    // UUID登录
    document.getElementById('uuidLoginBtn').addEventListener('click', function() {
      const uuid = document.getElementById('uuid').value.trim();
      if (!uuid) {
        alert('请输入访问密钥');
        return;
      }
      
      window.location.href = '/login/' + uuid;
    });
    
    // 按回车键登录
    document.getElementById('password').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        document.getElementById('passwordLoginBtn').click();
      }
    });
    
    document.getElementById('uuid').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        document.getElementById('uuidLoginBtn').click();
      }
    });
    
    // 加载自定义Logo
    function loadCustomLogo() {
      const savedLogo = localStorage.getItem('custom_logo');
      if (savedLogo) {
        const simpleLogo = document.getElementById('simple-login-logo');
        const loginFavicon = document.getElementById('login-favicon');
        
        if (simpleLogo) {
          simpleLogo.src = savedLogo;
        }
        
        if (loginFavicon) {
          loginFavicon.href = savedLogo;
        }
      }
    }
    
    // 获取安全认证有效年份
    function getSecurityCertificationYear() {
      // 当前固定返回2025年，未来可以改为从服务器获取实际证书有效期
      // 也可以增加逻辑，当系统时间超过2025年时，自动增加年份
      // 例如：if (new Date().getFullYear() > 2025) { return new Date().getFullYear(); }
      return "2025";
    }
    
    // 页面加载完成后加载自定义Logo
    document.addEventListener('DOMContentLoaded', function() {
      loadCustomLogo();
      
      // 更新安全验证标识的年份
      const currentYearElement = document.getElementById('simple-current-year');
      if (currentYearElement) {
        currentYearElement.textContent = getSecurityCertificationYear();
      }
    });
  </script>
</body>
</html>
`;

// HTML模板 - 404页面
const notFoundHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - 页面不存在</title>
  <link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=" type="image/svg+xml">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    body {
      background-color: #f5f5f5;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      color: #333;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      text-align: center;
      background-color: #fff;
      padding: 50px 30px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }
    .error-code {
      font-size: 120px;
      font-weight: bold;
      color: #e74c3c;
      line-height: 1;
      margin-bottom: 20px;
      letter-spacing: -3px;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 15px;
      color: #333;
    }
    p {
      font-size: 16px;
      color: #666;
      margin-bottom: 30px;
      line-height: 1.6;
    }
    .home-link {
      display: inline-block;
      padding: 12px 30px;
      background-color: #3498db;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-weight: bold;
      transition: background-color 0.3s;
    }
    .home-link:hover {
      background-color: #2980b9;
    }
    .icon {
      width: 100px;
      margin: 0 auto 20px;
    }
    .icon svg {
      width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    </div>
    <div class="error-code">404</div>
    <h1>页面不存在</h1>
    <p>抱歉，您尝试访问的页面不存在或可能已被移除。</p>
    <a href="https://inoo.fun/" class="home-link">返回首页</a>
  </div>
</body>
</html>
`;

// HTML模板 - 密码验证页面
const passwordVerifyHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>身份验证</title>
  <link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=" type="image/svg+xml" id="login-favicon">
  <style>
    /* 公共安全验证标识样式 */
    .public-security-verification {
      position: absolute;
      bottom: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      margin-top: 20px;
      width: 100%;
      display: flex;
      justify-content: center;
    }
    
    .security-badge {
      display: flex;
      align-items: center;
      background: linear-gradient(to right, #f3f4f6, #ffffff);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 8px;
      padding: 8px 12px;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.08);
      max-width: 220px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    
    .security-badge:hover {
      transform: translateY(-2px);
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12);
    }
    
    .badge-icon {
      color: #10b981;
      margin-right: 10px;
      flex-shrink: 0;
    }
    
    .badge-icon svg {
      width: 24px;
      height: 24px;
      stroke: currentColor;
      fill: rgba(16, 185, 129, 0.1);
    }
    
    .badge-text {
      display: flex;
      flex-direction: column;
    }
    
    .badge-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
      margin-bottom: 2px;
    }
    
    .badge-info {
      font-size: 0.65rem;
      color: #6b7280;
    }
    
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --primary-light: #dbeafe;
      --gray-50: #f9fafb;
      --gray-100: #f3f4f6;
      --gray-200: #e5e7eb;
      --gray-300: #d1d5db;
      --gray-400: #9ca3af;
      --gray-500: #6b7280;
      --gray-600: #4b5563;
      --gray-700: #374151;
      --gray-800: #1f2937;
      --gray-900: #111827;
      --danger: #ef4444;
      --success: #10b981;
      --border-radius: 8px;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    body {
      background-color: var(--gray-100);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 1rem;
      position: relative;
      overflow: hidden;  /* 防止气泡溢出 */
    }
    
    /* 全屏气泡背景 */
    .login-bubbles-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      pointer-events: none;
    }
    
    .login-card {
      background-color: white;
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-md);
      width: 100%;
      max-width: 400px;
      padding: 2rem;
      position: relative;
      z-index: 1;  /* 确保卡片在气泡上面 */
    }
    
    .header {
      text-align: center;
      margin-bottom: 1.25rem; /* 减少标题和表单之间的间距 */
    }
    
    .logo-container {
      display: flex;
      justify-content: center;
      margin-bottom: 1rem;
    }
    
    .login-logo {
      width: 60px;
      height: 60px;
      object-fit: contain;
      border-radius: 12px;
      box-shadow: 0 3px 6px rgba(0, 0, 0, 0.15);
      background-color: white;
      padding: 5px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    
    .login-logo:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    
    .title {
      font-size: 1.5rem;
      color: var(--gray-800);
      margin-bottom: 0.5rem;
    }
    
    .subtitle {
      font-size: 0.875rem;
      color: var(--gray-500);
    }
    
    .form-group {
      margin-bottom: 1.25rem;
    }
    
    .form-group:last-child {
      margin-bottom: 0;
    }
    
    .form-label {
      display: block;
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--gray-700);
    }
    
    .form-input {
      width: 100%;
      padding: 0.625rem 0.75rem;
      font-size: 0.875rem;
      background-color: white;
      border: 1px solid var(--gray-300);
      border-radius: var(--border-radius);
      transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
    }
    
    .form-input:focus {
      border-color: var(--primary);
      outline: 0;
      box-shadow: 0 0 0 3px var(--primary-light);
    }
    
    .submit-btn {
      width: 100%;
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: white;
      background-color: var(--primary);
      border: none;
      border-radius: var(--border-radius);
      cursor: pointer;
      transition: background-color 0.15s ease-in-out;
    }
    
    .submit-btn:hover {
      background-color: var(--primary-hover);
    }
    
    .submit-btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    
    .loader {
      display: none;
      width: 1.25rem;
      height: 1.25rem;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 0.8s linear infinite;
      margin-right: 0.5rem;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .btn-with-loader {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .error-message {
      display: none;
      color: var(--danger);
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }
    
    .success-message {
      display: none;
      color: var(--success);
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }
    
    .multi-auth-section {
      display: none;
      padding-top: 0.125rem; /* 非常小的上边距 */
      margin-top: 0.25rem; /* 非常小的上边距 */
      margin-bottom: 0.75rem; /* 减少下边距 */
      border-top: none; /* 删除黑色分隔线 */
      animation: fadeIn 0.3s ease;
    }
    
    .multi-auth-section .form-group {
      margin-bottom: 0;
      margin-top: 0.25rem; /* 非常小的上边距 */
    }
    
    .multi-auth-icon {
      margin-right: 0.375rem;
      vertical-align: text-bottom;
      color: var(--primary);
    }
    
    .multi-auth-hint {
      margin-top: 0.25rem; /* 减少提示文本的上边距 */
      font-size: 0.75rem;
      color: var(--gray-500);
      line-height: 1.4;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    /* 验证按钮额外间距 */
    .form-group.submit-group {
      margin-top: 1rem; /* 减少提交按钮的上边距 */
    }
    
    /* 安全提示样式 */
    .security-info {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--gray-200);
      color: var(--gray-600);
      font-size: 0.75rem;
    }
    
    .security-info svg {
      width: 1rem;
      height: 1rem;
      margin-right: 0.5rem;
      fill: #3b82f6;
    }
    
    .security-info span {
      white-space: nowrap;
    }
    
    /* 安全ID样式 */
    .security-id {
      text-align: center;
      margin-top: 0.5rem;
      font-size: 0.65rem;
      color: var(--gray-500);
      opacity: 0.8;
      font-family: monospace;
      letter-spacing: 0.5px;
    }
    
    .security-id-label {
      color: var(--gray-600);
      margin-right: 0.5rem;
    }
    
    /* 登录页面气泡样式 */
    .login-bubble {
      position: absolute;
      border-radius: 50%;
      background: var(--primary);
      animation-name: login-bubble-float;
      animation-timing-function: cubic-bezier(0.45, 0.05, 0.55, 0.95);
      animation-iteration-count: infinite;
      opacity: 0.4;
      filter: blur(1px);
      transform-origin: center;
      will-change: transform, opacity;
      /* 简化气泡效果，降低GPU压力 */
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.2) 15%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--primary); /* 内部高光效果 */
      box-shadow: 
        inset 0 0 5px rgba(255, 255, 255, 0.4),
        0 0 5px rgba(255, 255, 255, 0.2); /* 简化阴影效果 */
      border: 0; /* 移除边框 */
    }
    
    /* 不同颜色的气泡 - 简化背景渐变 */
    .login-bubble.primary { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--primary); 
    }
    .login-bubble.secondary { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--secondary); 
    }
    .login-bubble.danger { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--danger); 
    }
    .login-bubble.success { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--success); 
    }
    .login-bubble.gray { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--gray-700); 
    }
    .login-bubble.teal { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--teal, #14b8a6); 
    }
    .login-bubble.amber { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--amber, #f59e0b); 
    }
    .login-bubble.pink { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--pink, #ec4899); 
    }
    .login-bubble.indigo { 
      background: radial-gradient(circle at 30% 30%, 
        rgba(255, 255, 255, 0.5) 0%, 
        rgba(255, 255, 255, 0.0) 60%),
        var(--indigo, #6366f1); 
    }
    
    /* 登录气泡动画 - 简化变形和动画帧 */
    @keyframes login-bubble-float {
      0% {
        transform: translateY(0) translateX(0) rotate(0deg);
        opacity: 0.3;
      }
      50% {
        transform: translateY(-50vh) translateX(var(--bubble-x-offset-3, 5px)) rotate(var(--bubble-rotate-3, 135deg));
        opacity: 0.4;
      }
      100% {
        transform: translateY(-100vh) translateX(var(--bubble-x-offset-5, 20px)) rotate(var(--bubble-rotate-5, 180deg));
        opacity: 0;
      }
    }
  </style>
</head>
<body>
  <div class="login-bubbles-container" id="loginBubbles"></div>
  <div class="login-card">
    <div class="header">
      <div class="logo-container">
        <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=" id="login-logo" alt="系统Logo" class="login-logo">
      </div>
      <h1 class="title">系统认证</h1>
      <p class="subtitle">请输入访问密码继续</p>
    </div>
    
    <form id="login-form">
      <div class="form-group" style="margin-bottom: 0.25rem;">
        <label for="password" class="form-label">访问密码</label>
        <input type="password" id="password" class="form-input" placeholder="请输入密码" autofocus required>
      </div>
      
      <div class="multi-auth-section" id="multi-auth-section" style="padding-top: 0; margin-top: 0;">
        <div class="form-group">
          <label for="multi-auth-code" class="form-label">
            多重验证密钥
          </label>
          <input type="text" id="multi-auth-code" class="form-input" 
            placeholder="请输入多重验证密钥" 
            autocomplete="off" 
            autocorrect="off" 
            spellcheck="false"
            data-lpignore="true"
            onpaste="setTimeout(() => this.value = this.value.trim(), 10)">
          <p class="multi-auth-hint">请输入多重验证密钥 (注意大小写和空格)</p>
        </div>
      </div>
      
      <div class="form-group submit-group">
        <button type="submit" id="submit-btn" class="submit-btn btn-with-loader">
          <span id="loader" class="loader"></span>
          <span>验证并进入</span>
        </button>
        <p id="error-message" class="error-message"></p>
        <p id="success-message" class="success-message"></p>
      </div>
      
      <!-- 公共安全验证标识 -->
      <div style="margin-top: 20px; text-align: center;">
        <div class="security-badge" style="display: inline-flex; margin: 0 auto;">
          <div class="badge-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          </div>
          <div class="badge-text">
            <div class="badge-title">公共安全可信应用</div>
            <div class="badge-info">已通过安全认证 · <span id="current-year">2025</span></div>
          </div>
        </div>
      </div>
      
      <!-- 安全提示信息 -->
      <div class="security-info">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm0 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        <span>保护您的个人信息安全，请勿共享登录凭据</span>
      </div>
      
      <!-- 安全ID -->
      <div class="security-id">
        <span class="security-id-label">安全ID:</span>
        <span id="security-uuid"></span>
      </div>
    </form>
    
    <script>
      const form = document.getElementById('login-form');
      const passwordInput = document.getElementById('password');
      const multiAuthSection = document.getElementById('multi-auth-section');
      const multiAuthInput = document.getElementById('multi-auth-code');
      const submitBtn = document.getElementById('submit-btn');
      const loader = document.getElementById('loader');
      const errorMessage = document.getElementById('error-message');
      const successMessage = document.getElementById('success-message');
      const securityUuid = document.getElementById('security-uuid');
      
      // 初始化登录页面气泡背景
      function initLoginBubbles() {
        const bubblesContainer = document.getElementById('loginBubbles');
        if (!bubblesContainer) return;
        
        // 清空现有气泡
        bubblesContainer.innerHTML = '';
        
        // 定义CSS变量
        document.documentElement.style.setProperty('--secondary', '#9333ea'); // 紫色
        document.documentElement.style.setProperty('--teal', '#14b8a6');
        document.documentElement.style.setProperty('--amber', '#f59e0b');
        document.documentElement.style.setProperty('--pink', '#ec4899');
        document.documentElement.style.setProperty('--indigo', '#6366f1');
        
        // 生成分散的气泡，分批次创建，避免同时出现
        // 减少气泡数量，从原来的30-45个减少到10-15个
        const totalBubbles = 10 + Math.floor(Math.random() * 5);
        const batches = 3; // 从5批减少到3批
        const bubblesPerBatch = Math.ceil(totalBubbles / batches);
        
        // 初始创建第一批
        for (let i = 0; i < bubblesPerBatch; i++) {
          createLoginBubble(bubblesContainer);
        }
        
        // 延迟创建剩余批次
        for (let batch = 1; batch < batches; batch++) {
          setTimeout(() => {
            for (let i = 0; i < bubblesPerBatch; i++) {
              if (bubblesContainer) { // 确保容器仍然存在
                createLoginBubble(bubblesContainer);
              }
            }
          }, batch * 3000); // 每3秒创建一批（增加间隔）
        }
      }
      
      // 创建单个登录气泡
      function createLoginBubble(container) {
        const bubble = document.createElement('div');
        bubble.className = 'login-bubble';
        
        // 随机尺寸 (15-60px)
        const size = 15 + Math.random() * 45;
        bubble.style.width = size + 'px';
        bubble.style.height = size + 'px';
        
        // 随机水平位置
        bubble.style.left = Math.random() * 100 + '%';
        
        // 随机初始垂直位置 - 让气泡在整个高度上初始化，而不是全部从底部开始
        const initialY = Math.random() * 100; // 0-100%的随机初始位置
        bubble.style.bottom = -size + 'px'; // 默认从底部开始
        
        // 为每个气泡设置随机的动画时间点，避免同步移动
        const animationDelay = -Math.random() * 30 + 's'; // 负值延迟让气泡看起来已经在动画中间点开始
        bubble.style.animationDelay = animationDelay;
        
        // 简化每个气泡的CSS变量属性，减少重绘计算
        // 减少水平偏移量计算
        const xOffset = (Math.random() * 160 - 80) + 'px';
        bubble.style.setProperty('--bubble-x-offset-1', xOffset);
        bubble.style.setProperty('--bubble-x-offset-2', xOffset);
        bubble.style.setProperty('--bubble-x-offset-3', xOffset);
        bubble.style.setProperty('--bubble-x-offset-4', xOffset);
        bubble.style.setProperty('--bubble-x-offset-5', xOffset);
        
        // 简化形状变化，减少重绘压力
        const shapeValue = Math.random() * 10 + '%';
        bubble.style.setProperty('--bubble-shape-1', shapeValue);
        bubble.style.setProperty('--bubble-shape-2', shapeValue);
        bubble.style.setProperty('--bubble-shape-3', shapeValue);
        bubble.style.setProperty('--bubble-shape-4', shapeValue);
        
        // 简化旋转角度
        const rotateDirection = Math.random() > 0.5 ? 1 : -1; // 随机决定顺时针或逆时针旋转
        const baseRotation = Math.random() * 180; // 基础旋转角度
        const rotateValue = baseRotation + 'deg';
        bubble.style.setProperty('--bubble-rotate-1', rotateValue);
        bubble.style.setProperty('--bubble-rotate-2', rotateValue);
        bubble.style.setProperty('--bubble-rotate-3', rotateValue);
        bubble.style.setProperty('--bubble-rotate-4', rotateValue);
        bubble.style.setProperty('--bubble-rotate-5', rotateValue);
        
        // 增加动画持续时间 (20-40秒)，减少需要重绘的频率
        const duration = 20 + Math.random() * 20;
        bubble.style.animationDuration = duration + 's';
        
        // 随机颜色
        const colorChoices = ['primary', 'secondary', 'danger', 'success', 'gray', 'teal', 'amber', 'pink', 'indigo'];
        const colorClass = colorChoices[Math.floor(Math.random() * colorChoices.length)];
        bubble.classList.add(colorClass);
        
        // 随机透明度，增大透明度差异
        bubble.style.opacity = 0.2 + Math.random() * 0.3;
        
        // 随机模糊
        bubble.style.filter = 'blur(' + (1 + Math.random() * 2) + 'px)';
        
        container.appendChild(bubble);
        
        // 气泡完成一个循环后重新创建
        setTimeout(() => {
          if (container.contains(bubble)) {
            container.removeChild(bubble);
            createLoginBubble(container);
          }
        }, (duration) * 1000);
      }
      
      // 获取安全认证有效年份
      function getSecurityCertificationYear() {
        // 当前固定返回2025年，未来可以改为从服务器获取实际证书有效期
        // 也可以增加逻辑，当系统时间超过2025年时，自动增加年份
        // 例如：if (new Date().getFullYear() > 2025) { return new Date().getFullYear(); }
        return "2025";
      }
      
      // 页面加载时初始化气泡
      document.addEventListener('DOMContentLoaded', function() {
        initLoginBubbles();
        loadCustomLogo();
        
        // 更新安全验证标识的年份
        const currentYearElement = document.getElementById('current-year');
        if (currentYearElement) {
          currentYearElement.textContent = getSecurityCertificationYear();
        }
      });
      
      // 加载自定义Logo
      function loadCustomLogo() {
        const savedLogo = localStorage.getItem('custom_logo');
        if (savedLogo) {
          const loginLogo = document.getElementById('login-logo');
          const loginFavicon = document.getElementById('login-favicon');
          
          if (loginLogo) {
            loginLogo.src = savedLogo;
          }
          
          if (loginFavicon) {
            loginFavicon.href = savedLogo;
          }
        }
      }
      
      // 生成安全UUID
      function generateSecurityUuid() {
        const pattern = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
        return pattern.replace(/[xy]/g, function(c) {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
      
      // 显示安全UUID
      securityUuid.textContent = generateSecurityUuid();
      
      // 页面加载时检查多重验证配置
      function checkMultiFactorConfig() {
        // 获取UUID
        const path = window.location.pathname;
        const uuid = path.replace('/login/', '');
        
        // 仅当访问路径有UUID时才进行检查
        if (!uuid) {
          console.log('路径中未包含UUID，跳过多重验证配置检查');
          return;
        }
        
        console.log('开始检查多重验证配置，UUID长度:', uuid.length);
        
        // 发送无效密码的请求，查看服务器是否返回requireMultiAuth标志
        // 这将检查系统是否配置了ACCESS_MULTIFACTOR环境变量
        fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: '', uuid: uuid })
        })
        .then(response => {
          // 不再检查状态码，而是尝试解析JSON
          return response.json().catch(e => {
            console.error('解析响应失败:', e);
            throw new Error('服务器响应无效');
          });
        })
        .then(data => {
          console.log('多重验证检查响应:', JSON.stringify(data));
          
          // 检查是否需要多重验证
          if (data && data.requireMultiAuth) {
            // 如果服务器返回需要多重验证，显示多重验证输入框
            multiAuthSection.style.display = 'block';
            console.log('检测到多重验证配置已启用');
            
            // 出于安全考虑，不从本地存储恢复多重验证密钥
            console.log('出于安全考虑，不从本地存储恢复多重验证密钥');
          } else {
            console.log('未检测到多重验证配置');
          }
        })
        .catch(error => {
          console.error('检查多重验证配置失败:', error);
          // 出错时保守处理，显示多重验证输入框以防万一
          multiAuthSection.style.display = 'block';
          console.log('由于检查失败，默认显示多重验证输入框');
        });
      }
      
      // 页面加载时检查多重验证
      checkMultiFactorConfig();
      
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        submitForm();
      });
      
      function submitForm() {
        const password = passwordInput.value.trim();
        const multiAuthCode = multiAuthInput.value.trim();
        
        if (!password) {
          errorMessage.style.display = 'block';
          errorMessage.textContent = '请输入密码';
          return;
        }
        
        // 如果多重验证部分显示，但未填写验证码
        if (multiAuthSection.style.display === 'block' && !multiAuthCode) {
          errorMessage.style.display = 'block';
          errorMessage.textContent = '请输入UUID多重验证密钥';
          return;
        }
        
        // 记录尝试登录信息（仅用于调试）
        console.log('尝试登录 - 密码长度:', password.length);
        if (multiAuthCode) {
          console.log('尝试登录 - 多重验证密钥长度:', multiAuthCode.length);
        }
        
        // 开始加载状态
        submitBtn.disabled = true;
        loader.style.display = 'inline-block';
        errorMessage.style.display = 'none';
        successMessage.style.display = 'none';
        
        // 获取UUID
        const path = window.location.pathname;
        const uuid = path.replace('/login/', '');
        
        if (!uuid) {
          errorMessage.style.display = 'block';
          errorMessage.textContent = '无效的访问路径，请使用正确的登录链接';
          resetForm();
          return;
        }
        
        console.log('提交验证表单 - 使用UUID:', uuid);
        
        // 发送请求
        fetch('/api/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            password: password,
            uuid: uuid,
            multiAuthCode: multiAuthCode // 这是UUID格式的多重验证密钥
          })
        })
        .then(response => {
          // 即使状态码为200，我们也需要检查JSON响应中的success字段
          if (!response.ok) {
            console.error('请求失败，状态码:', response.status);
          }
          return response.json().catch(e => {
            throw new Error('解析响应失败: ' + e.message);
          });
        })
        .then(data => {
          console.log('收到验证响应:', JSON.stringify(data));
          
          if (data.success) {
            // 认证成功
            successMessage.style.display = 'block';
            successMessage.textContent = '验证成功，正在进入系统...';
            
            // 出于安全考虑，不保存多重验证密钥到本地存储
            console.log('出于安全考虑，多重验证密钥不会保存到本地存储');
            
            // 显示系统名称（如果存在）
            if (data.systemName) {
              document.title = data.systemName;
            }
            
            // 跳转到主页
            setTimeout(() => {
              // 刷新当前页面而不是重定向，这样认证状态会被保留
              window.location.reload();
            }, 1000);
          } else {
            // 重置表单状态
            resetForm();
            
            // 检查是否需要多重验证
            if (data.requireMultiAuth) {
              multiAuthSection.style.display = 'block';
            }
            
            // 显示错误消息
            errorMessage.style.display = 'block';
            errorMessage.textContent = data.error || '验证失败，请重试';
            
            // 清空密码但保留多重验证码（可能只是密码错误）
            passwordInput.value = '';
          }
        })
        .catch(error => {
          console.error('验证请求出错:', error);
          resetForm();
          errorMessage.style.display = 'block';
          errorMessage.textContent = '验证过程中发生错误，请重试: ' + error.message;
        });
      }
      
      function resetForm() {
        submitBtn.disabled = false;
        submitBtn.textContent = '验证并进入';
        loader.style.display = 'none';
      }
      
      // 清除错误消息
      passwordInput.addEventListener('input', function() {
        errorMessage.style.display = 'none';
      });
      
      multiAuthInput.addEventListener('input', function() {
        errorMessage.style.display = 'none';
      });
      
      // 自动格式化UUID - 自动去除输入中的空格和其他不必要的字符
      multiAuthInput.addEventListener('blur', function() {
        // 去除空格和其他不必要的字符
        this.value = this.value.trim();
        console.log('UUID格式化后长度:', this.value.length);
      });
      
      // 从URL参数中获取预填充的多重验证码（如果有）
      function getMultiAuthFromUrl() {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const multiAuth = urlParams.get('code');
          if (multiAuth) {
            console.log('从URL参数中获取到多重验证码');
            multiAuthInput.value = multiAuth;
            // 自动显示多重验证部分
            multiAuthSection.style.display = 'block';
            
            // 如果同时有密码参数，可以自动提交
            const autoPassword = urlParams.get('pw');
            if (autoPassword) {
              passwordInput.value = autoPassword;
              // 短暂延迟后自动提交
              setTimeout(() => {
                submitBtn.click();
              }, 500);
            }
          }
        } catch (e) {
          console.error('尝试从URL获取多重验证码失败:', e);
        }
      }
      
      // 页面加载时检查多重验证配置和URL参数
      checkMultiFactorConfig();
      getMultiAuthFromUrl();
    </script>
  </div>
</body>
</html>
`;

// 工具函数 - 生成唯一ID
function generateId() {
  // 增强ID生成算法，提高唯一性和安全性
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substr(2, 8);
  const secondRandom = Math.random().toString(36).substr(2, 5);
  return `${timestamp}-${randomStr}-${secondRandom}`;
}

// 检查认证状态
function checkAuth() {
  const now = Date.now();
  
  // 如果未认证或已过期，直接返回false
  if (!isAuthenticated || now >= authExpiry) {
    if (isAuthenticated && now >= authExpiry) {
      console.log('会话已过期');
      // 重置认证状态
      setAuth(false);
    }
    return false;
  }
  
  // 更新最后活动时间
  authClientInfo.lastActivity = now;
  
  // 检查客户端信息（如果有）
  if (currentRequest && authClientInfo.ip && authClientInfo.userAgent) {
    const currentIP = currentRequest.headers.get('CF-Connecting-IP') || 
                     currentRequest.headers.get('X-Forwarded-For') || 
                     'unknown';
    const currentUA = currentRequest.headers.get('User-Agent') || 'unknown';
    
    // 检查客户端信息是否匹配（IP和UA至少一个必须匹配，以允许移动网络IP变化）
    const ipMatch = (currentIP === authClientInfo.ip);
    const uaMatch = (currentUA === authClientInfo.userAgent);
    
    if (!ipMatch && !uaMatch) {
      console.error('客户端信息不匹配，可能的会话劫持尝试');
      console.error(`存储的IP: ${authClientInfo.ip}, 当前IP: ${currentIP}`);
      console.error(`UA匹配: ${uaMatch}`);
      
      // 可能是会话劫持，重置认证状态
      setAuth(false);
      return false;
    }
  }
  
  // 延长会话时间（如果活动超过会话期限的一半）
  if (now - authClientInfo.lastActivity > SESSION_DURATION / 2) {
    console.log('活动检测，延长会话时间');
    // 延长会话，但不完全重置，以确保总时间不超过两倍SESSION_DURATION
    authExpiry = Math.min(now + SESSION_DURATION, authClientInfo.lastActivity + SESSION_DURATION * 2);
  }
  
  return true;
}

// 设置认证状态
function setAuth(value, sessionId = null) {
  isAuthenticated = value;
  
  if (value) {
    // 设置新的过期时间
    authExpiry = Date.now() + SESSION_DURATION;
    
    // 如果提供了会话ID，则使用它；否则生成一个新的
    const newSessionId = sessionId || generateId();
    
    // 生成会话密钥（用于在请求之间验证会话完整性）
    const sessionKey = crypto.getRandomValues(new Uint8Array(32))
      .reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
    
    // 存储客户端信息用于会话验证
    if (currentRequest) {
      authClientInfo = {
        ip: currentRequest.headers.get('CF-Connecting-IP') || 
            currentRequest.headers.get('X-Forwarded-For') || 
            'unknown',
        userAgent: currentRequest.headers.get('User-Agent') || 'unknown',
        lastActivity: Date.now(),
        sessionId: newSessionId,
        sessionKey: sessionKey
      };
      console.log('已存储客户端信息用于会话验证，会话ID:', newSessionId.substring(0, 8) + '...');
      
      // 在KV存储中保存会话数据，如果KV可用
      if (isKvAvailable) {
        try {
          // 安全地存储会话数据
          const sessionData = {
            ip: authClientInfo.ip,
            userAgent: authClientInfo.userAgent,
            createdAt: Date.now(),
            expiresAt: authExpiry,
            sessionKey: sessionKey
          };
          
          // 异步存储会话数据
          const kv = getKV();
          kv.put(`session:${newSessionId}`, JSON.stringify(sessionData), {
            expirationTtl: Math.floor(SESSION_DURATION / 1000) // 转换为秒
          }).catch(err => {
            console.error('存储会话数据失败:', err);
          });
        } catch (e) {
          console.error('准备会话数据存储时出错:', e);
        }
      }
    }
  } else {
    authExpiry = 0;
    
    // 如果存在会话ID，尝试从KV存储中删除
    if (authClientInfo.sessionId && isKvAvailable) {
      try {
        const kv = getKV();
        kv.delete(`session:${authClientInfo.sessionId}`).catch(err => {
          console.error('删除会话数据失败:', err);
        });
      } catch (e) {
        console.error('尝试删除会话数据时出错:', e);
      }
    }
    
    // 清除客户端信息
    authClientInfo = {
      ip: null,
      userAgent: null,
      lastActivity: 0,
      sessionId: null,
      sessionKey: null
    };
  }
  
  return authClientInfo.sessionId; // 返回会话ID
}

// 存储当前请求的引用
let currentRequest = null;

// 处理请求
async function handleRequest(request) {
  // 将请求对象存储在变量中，以便workerStorage可以访问
  currentRequest = request;
  
  // 检查并更新动态锁（迁移到请求处理程序中）
  checkAndUpdateDynamicLock();
  
  // 定期清理记录
  cleanupRecords();
  
  const url = new URL(request.url);
  const path = url.pathname;
  
  // 获取客户端IP地址（用于安全检查）
  const clientIP = request.headers.get('CF-Connecting-IP') || 
                   request.headers.get('X-Forwarded-For') || 
                   'unknown';
                   
  // 检查是否是敏感API请求
  const isSensitiveApiRequest = path.startsWith('/api/') && 
                             (path.includes('/create') || 
                              path.includes('/update') || 
                              path.includes('/delete') || 
                              path.includes('/import'));
  
  // 对敏感操作进行额外的安全检查
  if (isSensitiveApiRequest) {
    // 检查Referer头是否来自同一域名
    const referer = request.headers.get('Referer') || '';
    const host = request.headers.get('Host') || '';
    
    if (!referer.includes(host) && referer !== '') {
      console.error(`可疑请求: 来自IP ${clientIP}的敏感操作，Referer不匹配: ${referer}`);
      return new Response(JSON.stringify({ error: '无效的请求来源', code: 'INVALID_SOURCE' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 验证CSRF令牌
    const csrfToken = request.headers.get('X-CSRF-Token');
    const sessionId = request.headers.get('X-Session-ID');
    
    if (!csrfToken || !sessionId || !verifyCSRFToken(csrfToken, sessionId)) {
      console.error(`CSRF防护: 来自IP ${clientIP}的敏感操作被阻止，无效的CSRF令牌`);
      return new Response(JSON.stringify({ 
        error: '无效的安全令牌', 
        code: 'INVALID_TOKEN',
        description: '需要有效的CSRF令牌才能执行此操作' 
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 记录敏感操作
    console.log(`敏感操作: ${path}，IP: ${clientIP}，时间: ${new Date().toISOString()}`);
  }
  
  // 处理favicon.ico请求
  if (path === '/favicon.ico') {
    // 使用Base64编码的SVG图标
    const svgBase64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNiAzNiI+PHBhdGggZmlsbD0iIzI1NjNlYiIgZD0iTTI5LjUgNmgtMjJDNi4xMiA2IDUgNy4xMiA1IDguNXYyMkM1IDMxLjg4IDYuMTIgMzMgNy41IDMzaDIyYzEuMzggMCAyLjUtMS4xMiAyLjUtMi41di0yMkMzMiA3LjEyIDMwLjg4IDYgMjkuNSA2eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0yMi4zMSA5LjM5TDEyLjUgNi4zMmMtLjQxLS4xMy0uODEuMTItLjgxLjU1djIzLjFjMCAuMjIuMTguNDEuNDEuNDEuMDQgMCAuMDktLjAxLjEzLS4wMmw5LjkxLTMuMDdjLjI2LS4wOC40NS0uMzIuNDUtLjZWOS45NmMwLS4zMS0uMjctLjUzLS41OC0uNDl6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI0LjUgMTJoLTJ2MmgydjE0aC0ydjJoMmMxLjEgMCAyLS45IDItMlYxNGMwLTEuMS0uOS0yLTItMnoiLz48L3N2Zz4=';
    const svgData = atob(svgBase64);
    
    return new Response(svgData, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  }
  
  // 检查API请求头中的动态锁
  if (path.startsWith('/api/') && path !== '/api/login' && path !== '/api/verify') {
    const providedLock = request.headers.get('X-Dynamic-Lock');
    
    // 如果未提供动态锁或验证失败且未认证
    if (!providedLock && !checkAuth()) {
      return new Response(JSON.stringify({ error: '未授权访问', code: 'AUTH_REQUIRED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 如果提供了动态锁但验证失败且未认证
    if (providedLock && !verifyDynamicLock(providedLock) && !checkAuth()) {
      // 记录可疑请求
      console.error(`安全警告: IP ${clientIP} 提供了无效的动态锁: ${providedLock.substring(0, 10)}...`);
      
      return new Response(JSON.stringify({ error: '安全锁无效', code: 'INVALID_LOCK' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // 登录路由
  if (path.startsWith('/login/')) {
    const providedUuid = path.replace('/login/', '');
    // @ts-ignore
    if (providedUuid === ACCESS_UUID) {
      // 检查是否已验证
      if (checkAuth()) {
        // 已认证，显示管理页面，但保留URL路径
        return new Response(indexHtml, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } else {
        // 未认证，显示密码验证页面，不需要传递UUID参数，直接从路径获取
        return new Response(passwordVerifyHtml, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    } else {
      // 返回美化的404页面
      return new Response(notFoundHtml, { 
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  }
  
  // 密码验证API
  if (path === '/api/verify' && request.method === 'POST') {
    try {
      const requestData = await request.json();
      const { password, uuid, multiAuthCode } = requestData || {};
      
      // 获取客户端IP
      const clientIP = request.headers.get('CF-Connecting-IP') || 
                       request.headers.get('X-Forwarded-For') || 
                       'unknown';
      
      // 记录验证尝试（不包含密码内容）
      console.log('API验证尝试 - 数据:', JSON.stringify({
        uuid_length: uuid ? uuid.length : 0,
        has_password: !!password,
        has_multiAuthCode: !!multiAuthCode,
        client_ip: clientIP
      }));
      
      // 创建一个通用的响应创建函数
      const createResponse = (success, error, requireMultiAuth, status = 200, extraData = {}) => {
        return new Response(JSON.stringify({
          success,
          error,
          requireMultiAuth,
          ...extraData
        }), {
          status,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Access-Control-Allow-Origin': '*'
          }
        });
      };
      
      // 检查是否设置了多重验证环境变量
      // @ts-ignore
      const isMultiFactorEnabled = typeof ACCESS_MULTIFACTOR !== 'undefined';
      console.log('多重验证已启用?', isMultiFactorEnabled ? '是' : '否');
      
      // 如果前端只是在探测是否需要多重验证（不提供密码或提供空密码）
      if (!password || password === '') {
        console.log('只是探测多重验证配置，返回requireMultiAuth标志');
        return createResponse(false, '请提供密码', isMultiFactorEnabled, 200);
      }
      
      // 检查暴力破解防护
      const bruteForceCheck = checkBruteForceAttempt(clientIP);
      if (!bruteForceCheck.allowed) {
        console.warn(`防暴力破解：IP ${clientIP} 因尝试次数过多被锁定`);
        return createResponse(false, bruteForceCheck.message, false, 429, {
          locked: true,
          remainingTime: bruteForceCheck.remainingTime
        });
      }
      
      // 检查UUID是否有效
      // @ts-ignore
      if (!uuid || uuid !== ACCESS_UUID) {
        console.log('UUID验证失败');
        return createResponse(false, 'UUID无效或未提供', false, 200);
      }
      
      // 验证密码是否正确
      let passwordValid = false;
      
      try {
        // 获取存储的密码信息（在生产环境中，这应该从安全存储中获取）
      // @ts-ignore
        const storedPassword = ACCESS_PASSWORD;
        
        // 1. 检查是否已经是哈希格式（针对迁移场景）
        // 假设哈希存储格式为 hash:salt
        if (storedPassword.includes(':')) {
          const [storedHash, storedSalt] = storedPassword.split(':');
          // 使用安全的密码验证
          passwordValid = await verifyPassword(password, storedHash, storedSalt);
        } else {
          // 2. 直接比较明文密码（兼容旧系统）
          // @ts-ignore
          passwordValid = (password === ACCESS_PASSWORD);
          
          // 未来可以添加代码自动将明文密码升级为哈希存储
          // 但这需要能够更新环境变量，这在Cloudflare Worker中通常不直接支持
        }
      } catch (error) {
        console.error('密码验证过程出错:', error);
        passwordValid = false; // 出错时默认验证失败
      }
      
      if (!passwordValid) {
        console.log('密码验证失败');
        return createResponse(false, '验证失败，密码错误', isMultiFactorEnabled, 200);
      }
      
      console.log('UUID和密码验证通过');
      
      // 如果启用了多重验证，则还需要检查验证码
      if (isMultiFactorEnabled) {
        // @ts-ignore
        // ACCESS_MULTIFACTOR是UUID格式的多重验证密钥，必须完全匹配
        const providedAuth = multiAuthCode ? multiAuthCode.trim() : '';
        // @ts-ignore
        const expectedAuth = ACCESS_MULTIFACTOR ? ACCESS_MULTIFACTOR.trim() : '';
        
        console.log('多重验证检查 - 提供的多重验证密钥长度:', providedAuth.length);
        console.log('多重验证检查 - 预期的多重验证密钥长度:', expectedAuth.length);
        
        // 检查是否匹配（比较两个字符串，忽略大小写）
        if (!providedAuth || providedAuth.toLowerCase() !== expectedAuth.toLowerCase()) {
          console.error('多重验证失败 - 提供的密钥与预期不匹配');
          return createResponse(false, '多重验证密钥错误', true, 200);
        }
        console.log('多重验证通过');
      }
      
      // 所有验证都通过，记录成功登录并重置尝试计数
      recordSuccessfulLogin(clientIP);
      
      // 生成会话ID用于CSRF保护
      const sessionId = generateId(); // 生成一个会话ID
      
      // 设置认证状态并传递会话ID
      setAuth(true, sessionId);
      
      // 生成CSRF令牌
      const csrfToken = generateCSRFToken(sessionId);
      
      // 返回成功，包含更明确的成功信息和CSRF令牌
      return createResponse(true, '', false, 200, {
        csrfToken: csrfToken,
        sessionId: sessionId
      });
    } catch (error) {
      console.error('验证API处理错误:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请求处理失败: ' + (error.message || '未知错误')
      }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }
  }
  
  // 登出路由
  if (path === '/api/logout' && request.method === 'POST') {
    setAuth(false);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // API路由 - 需要认证
  if (path.startsWith('/api/')) {
    if (!checkAuth()) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 获取所有备忘录
    if (path === '/api/memos' && request.method === 'GET') {
      return await handleGetAllMemos();
    }
    
    // 导入备忘录
    if (path === '/api/memos/import' && request.method === 'POST') {
      try {
        return await handleImportMemos(request);
      } catch (error) {
        console.error('处理导入请求时发生错误:', error);
        return new Response(JSON.stringify({ 
          error: '处理导入请求失败', 
          message: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 创建新备忘录
    if (path === '/api/memos' && request.method === 'POST') {
      return await handleCreateMemo(request);
    }
    
    // 获取单个备忘录详情
    const memoIdMatch = path.match(/^\/api\/memos\/(.+)$/);
    if (memoIdMatch && request.method === 'GET') {
      const memoId = memoIdMatch[1];
      return await handleGetMemo(memoId);
    }
    
    // 更新备忘录
    if (memoIdMatch && request.method === 'PUT') {
      const memoId = memoIdMatch[1];
      return await handleUpdateMemo(request, memoId);
    }
    
    // 删除备忘录
    if (memoIdMatch && request.method === 'DELETE') {
      const memoId = memoIdMatch[1];
      return await handleDeleteMemo(memoId);
    }
    
    // API路由不存在
    return new Response(JSON.stringify({ error: '接口不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // 主页 - 需要已认证
  if (path === '/' || path === '') {
    if (!checkAuth()) {
      // 未认证返回美化的404页面
      return new Response(notFoundHtml, { 
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 已认证，重定向到带UUID的路径以保持一致性
    // @ts-ignore
    return Response.redirect(url.origin + '/login/' + ACCESS_UUID, 302);
  }
  
  // 所有其他路径返回美化的404页面
  return new Response(notFoundHtml, { 
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 获取所有备忘录
async function handleGetAllMemos() {
  try {
    console.log('开始获取备忘录列表');
    
    // 尝试获取数据
    let memosData;
    try {
      memosData = await getKV().get('all_memos');
      console.log('从KV获取的原始数据:', memosData ? '数据存在' : '数据为空');
    } catch (kvError) {
      console.error('KV获取错误:', kvError);
      // 返回空数组作为应急措施
      return new Response(JSON.stringify([]), {
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache'
        }
      });
    }
    
    // 解析数据
    let memosJson = [];
    if (memosData) {
      try {
        memosJson = JSON.parse(memosData);
        console.log('解析后的备忘录数量:', Array.isArray(memosJson) ? memosJson.length : '不是数组');
      } catch (parseError) {
        console.error('JSON解析错误:', parseError);
        // 解析失败就使用空数组
        memosJson = [];
      }
    }
    
    // 确保返回的是数组
    if (!Array.isArray(memosJson)) {
      console.log('memosJson不是数组，重置为空数组');
      memosJson = [];
      // 尝试修复KV中的数据
      try {
        await getKV().put('all_memos', JSON.stringify(memosJson));
        console.log('已更新KV中的数据为空数组');
      } catch (putError) {
        console.error('更新KV数据失败:', putError);
      }
    }
    
    // 按创建时间降序排序
    memosJson.sort((a, b) => b.createdAt - a.createdAt);
    
    // 创建响应
    const jsonData = JSON.stringify(memosJson);
    const response = new Response(jsonData, {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    // 添加用于客户端持久化存储的头信息
    response.headers.set('X-Backup-Data', 'true');
    
    // 设置Cookie以便在Worker环境中访问（有效期30天）
    const dataObject = {};
    dataObject['all_memos'] = jsonData;
    const cookieValue = encodeURIComponent(JSON.stringify({ [STORAGE_KEY]: dataObject }));
    if (cookieValue.length < 4000) { // 避免Cookie过大
      response.headers.set('Set-Cookie', 
        STORAGE_KEY + '=' + cookieValue + '; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict');
    }
    
    console.log('返回备忘录列表, 数量:', memosJson.length);
    return response;
  } catch (error) {
    console.error('获取备忘录失败:', error);
    // 返回空数组而不是错误，避免前端崩溃
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 创建新备忘录
async function handleCreateMemo(request) {
  try {
    const memoData = await request.json();
    
    if (!memoData.title || !memoData.content) {
      return new Response(JSON.stringify({ error: '标题和内容不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const memo = {
      id: generateId(),
      title: memoData.title,
      content: memoData.content,
      category: memoData.category || '其他',
      categoryColor: memoData.categoryColor || '1',
      createdAt: Date.now()
    };
    
    // 获取现有备忘录列表
    let memos = [];
    try {
      const memosData = await getKV().get('all_memos');
      if (memosData) {
        try {
          const parsedData = JSON.parse(memosData);
          if (Array.isArray(parsedData)) {
            memos = parsedData;
          }
        } catch (parseError) {
          console.error('JSON解析错误:', parseError);
        }
      }
    } catch (kvError) {
      console.error('KV获取错误:', kvError);
    }
    
    // 添加新备忘录
    memos.push(memo);
    
    // 保存更新后的备忘录列表
    try {
      await getKV().put('all_memos', JSON.stringify(memos));
    } catch (putError) {
      console.error('保存到KV失败:', putError);
      return new Response(JSON.stringify({ error: '保存备忘录失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify(memo), {
      status: 201,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  } catch (error) {
    console.error('创建备忘录失败:', error);
    return new Response(JSON.stringify({ 
      error: '创建备忘录失败', 
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取单个备忘录
async function handleGetMemo(memoId) {
  try {
    let memos = [];
    try {
      const memosData = await getKV().get('all_memos');
      if (memosData) {
        try {
          const parsedData = JSON.parse(memosData);
          if (Array.isArray(parsedData)) {
            memos = parsedData;
          }
        } catch (parseError) {
          console.error('JSON解析错误:', parseError);
        }
      }
    } catch (kvError) {
      console.error('KV获取错误:', kvError);
    }
    
    const memo = memos.find(m => m.id === memoId);
    
    if (!memo) {
      return new Response(JSON.stringify({ error: '备忘录不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify(memo), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache'
      }
    });
  } catch (error) {
    console.error('获取备忘录详情失败:', error);
    return new Response(JSON.stringify({ 
      error: '获取备忘录失败', 
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 更新备忘录
async function handleUpdateMemo(request, memoId) {
  try {
    const updateData = await request.json();
    
    if (!updateData.title || !updateData.content) {
      return new Response(JSON.stringify({ error: '标题和内容不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    let memos = [];
    try {
      const memosData = await getKV().get('all_memos');
      if (memosData) {
        try {
          const parsedData = JSON.parse(memosData);
          if (Array.isArray(parsedData)) {
            memos = parsedData;
          }
        } catch (parseError) {
          console.error('JSON解析错误:', parseError);
        }
      }
    } catch (kvError) {
      console.error('KV获取错误:', kvError);
    }
    
    const memoIndex = memos.findIndex(m => m.id === memoId);
    
    if (memoIndex === -1) {
      return new Response(JSON.stringify({ error: '备忘录不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 更新备忘录
    memos[memoIndex] = {
      ...memos[memoIndex],
      title: updateData.title,
      content: updateData.content,
      category: updateData.category || memos[memoIndex].category || '其他',
      categoryColor: updateData.categoryColor || memos[memoIndex].categoryColor || '1',
      updatedAt: Date.now() // 添加更新时间
    };
    
    // 保存更新后的备忘录列表
    try {
      await getKV().put('all_memos', JSON.stringify(memos));
    } catch (putError) {
      console.error('保存到KV失败:', putError);
      return new Response(JSON.stringify({ error: '更新备忘录失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify(memos[memoIndex]), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache'
      }
    });
  } catch (error) {
    console.error('更新备忘录失败:', error);
    return new Response(JSON.stringify({ 
      error: '更新备忘录失败', 
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 删除备忘录
async function handleDeleteMemo(memoId) {
  try {
    let memos = [];
    try {
      const memosData = await getKV().get('all_memos');
      if (memosData) {
        try {
          const parsedData = JSON.parse(memosData);
          if (Array.isArray(parsedData)) {
            memos = parsedData;
          }
        } catch (parseError) {
          console.error('JSON解析错误:', parseError);
        }
      }
    } catch (kvError) {
      console.error('KV获取错误:', kvError);
    }
    
    // 过滤掉要删除的备忘录
    const newMemos = memos.filter(memo => memo.id !== memoId);
    
    if (newMemos.length === memos.length) {
      return new Response(JSON.stringify({ error: '备忘录不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 保存更新后的备忘录列表
    try {
      await getKV().put('all_memos', JSON.stringify(newMemos));
    } catch (putError) {
      console.error('保存到KV失败:', putError);
      return new Response(JSON.stringify({ error: '删除备忘录失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: '删除成功' 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache'
      }
    });
  } catch (error) {
    console.error('删除备忘录失败:', error);
    return new Response(JSON.stringify({ 
      error: '删除备忘录失败', 
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 监听请求
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// 处理备忘录导入
async function handleImportMemos(request) {
  try {
    console.log('开始处理备忘录导入请求');
    
    // 尝试解析请求体
    let importData;
    try {
      importData = await request.json();
      console.log('成功解析导入数据');
    } catch (parseError) {
      console.error('解析请求数据失败:', parseError);
      return new Response(JSON.stringify({ 
        error: '无法解析请求数据', 
        details: parseError.message
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 检验数据类型
    if (!importData) {
      console.error('导入数据为空');
      return new Response(JSON.stringify({ error: '导入数据为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 处理多种数据格式
    let memosArray;
    if (Array.isArray(importData)) {
      console.log('检测到数组格式导入数据');
      memosArray = importData;
    } else if (importData.data && Array.isArray(importData.data)) {
      console.log('检测到对象格式导入数据');
      memosArray = importData.data;
    } else {
      console.error('无法识别的数据格式:', Object.keys(importData));
      return new Response(JSON.stringify({ 
        error: '无效的导入数据格式',
        hint: '数据应为备忘录数组或包含data字段的对象'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 验证导入数据的结构
    console.log('正在验证备忘录数据...');
    const validMemos = memosArray.filter(memo => 
      memo && typeof memo === 'object' && 
      memo.title && typeof memo.title === 'string' &&
      memo.content && typeof memo.content === 'string'
    );
    
    console.log('验证结果: 总计 ' + memosArray.length + ' 条，有效 ' + validMemos.length + ' 条');
    
    if (validMemos.length === 0) {
      return new Response(JSON.stringify({ 
        error: '导入数据中没有有效的备忘录',
        hint: '每条备忘录需要至少包含title和content字段'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 确保每个备忘录都有必需的字段
    const normalizedMemos = validMemos.map(memo => {
      // 保留原有ID，如果存在的话
      const id = memo.id && typeof memo.id === 'string' ? memo.id : generateId();
      
      return {
        id: id,
        title: String(memo.title).substring(0, 200), // 限制标题长度
        content: String(memo.content).substring(0, 10000), // 限制内容长度
        category: memo.category && typeof memo.category === 'string' ? memo.category : '其他',
        categoryColor: /^[1-5]$/.test(memo.categoryColor) ? memo.categoryColor : '1',
        createdAt: Number.isInteger(memo.createdAt) ? memo.createdAt : Date.now(),
        updatedAt: Number.isInteger(memo.updatedAt) ? memo.updatedAt : null
      };
    });
    
    console.log('准备保存 ' + normalizedMemos.length + ' 条备忘录到存储');
    
    // 获取当前备忘录
    let currentMemosData;
    let currentMemos = [];
    try {
      currentMemosData = await getKV().get('all_memos');
      if (currentMemosData) {
        currentMemos = JSON.parse(currentMemosData);
        if (!Array.isArray(currentMemos)) {
          console.error('当前存储的备忘录数据不是数组，将重置');
          currentMemos = [];
        } else {
          console.log('当前存储中有 ' + currentMemos.length + ' 条备忘录');
        }
      }
    } catch (getError) {
      console.error('获取当前备忘录失败:', getError);
      console.log('将使用空数组作为当前备忘录');
      currentMemos = [];
    }
    
    // 确定保存策略：合并或替换
    let finalMemos;
    try {
      const replaceAll = true; // 设置为false将进行合并而不是替换
      
      if (replaceAll) {
        finalMemos = normalizedMemos;
        console.log('使用替换策略：全部替换现有备忘录');
      } else {
        // 创建ID映射以便高效查找
        const memoIdMap = {};
        currentMemos.forEach(memo => {
          if (memo && memo.id) {
            memoIdMap[memo.id] = true;
          }
        });
        
        // 合并新备忘录，避免重复ID
        const newMemos = normalizedMemos.filter(memo => !memoIdMap[memo.id]);
        finalMemos = [...currentMemos, ...newMemos];
        console.log('使用合并策略：添加 ' + newMemos.length + ' 条新备忘录');
      }
    } catch (mergeError) {
      console.error('合并备忘录时出错:', mergeError);
      return new Response(JSON.stringify({ 
        error: '处理备忘录数据时出错', 
        details: mergeError.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 保存到KV存储
    try {
      const dataToSave = JSON.stringify(finalMemos);
      console.log('准备保存数据，大小约 ' + Math.round(dataToSave.length / 1024) + ' KB');
      
      await getKV().put('all_memos', dataToSave);
      console.log('成功保存备忘录到存储');
    } catch (putError) {
      console.error('保存到存储失败:', putError);
      return new Response(JSON.stringify({ 
        error: '保存导入数据失败', 
        details: putError.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: '成功导入 ' + normalizedMemos.length + ' 条备忘录'
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache'
      }
    });
  } catch (error) {
    console.error('导入处理过程中发生未预期错误:', error);
    return new Response(JSON.stringify({ 
      error: '导入备忘录失败', 
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

