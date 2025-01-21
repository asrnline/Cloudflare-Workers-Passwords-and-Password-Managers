// 定义 HTML 模板
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>密码与密钥管理器</title>
    
    <!-- 添加网站图标 -->
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234CAF50">
            <path d="M12 1C8.676 1 6 3.676 6 7v3H4v12h16V10h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v3H8V7c0-2.276 1.724-4 4-4z"/>
            <circle cx="12" cy="15" r="2"/>
        </svg>
    `)}">
    
    <!-- 添加 PWA 支持 -->
    <link rel="manifest" href="data:application/json,${encodeURIComponent(`{
        "name": "密码与密钥管理器",
        "short_name": "密钥管理",
        "icons": [
            {
                "src": "data:image/svg+xml,${encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234CAF50">
                        <path d="M12 1C8.676 1 6 3.676 6 7v3H4v12h16V10h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v3H8V7c0-2.276 1.724-4 4-4z"/>
                        <circle cx="12" cy="15" r="2"/>
                    </svg>
                `)}",
                "sizes": "192x192",
                "type": "image/svg+xml"
            }
        ],
        "start_url": "/",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": "#4CAF50"
    }`)}">
    
    <!-- 添加 Apple 设备支持 -->
    <link rel="apple-touch-icon" href="data:image/svg+xml,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234CAF50">
            <path d="M12 1C8.676 1 6 3.676 6 7v3H4v12h16V10h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v3H8V7c0-2.276 1.724-4 4-4z"/>
            <circle cx="12" cy="15" r="2"/>
        </svg>
    `)}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#4CAF50">

    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --primary-color: #4CAF50;
            --danger-color: #f44336;
            --background-color: #f5f5f5;
            --card-color: #ffffff;
            --text-color: #333333;
            --border-color: #e0e0e0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            margin: 0;
            padding: 20px;
            background: var(--background-color);
            color: var(--text-color);
            min-height: 100vh;
            box-sizing: border-box;
        }

        .page-container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 30px;
        }

        .header h1 {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 24px;
            color: var(--text-color);
        }

        .header-icon {
            width: 36px;
            height: 36px;
            fill: var(--primary-color);
        }

        .main-content {
            display: grid;
            grid-template-columns: 1fr 300px;
            gap: 20px;
            align-items: start;
        }

        .content-section {
            background: var(--card-color);
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .tools-section {
            position: sticky;
            top: 20px;
        }

        .tool-card {
            background: var(--card-color);
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }

        .tool-card h3 {
            margin: 0 0 15px 0;
            font-size: 1.2em;
            color: var(--text-color);
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            color: #666;
        }

        input, textarea, select {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            box-sizing: border-box;
        }

        textarea {
            min-height: 100px;
            resize: vertical;
        }

        button {
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            width: 100%;
        }

        button:hover {
            opacity: 0.9;
        }

        .items-list {
            margin-top: 20px;
        }

        .item {
            border: 1px solid var(--border-color);
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 8px;
            position: relative;
        }

        .item h4 {
            margin: 0 0 10px 0;
            padding-right: 80px;
        }

        .platform-tag {
            display: inline-block;
            padding: 3px 8px;
            background: #e8f5e9;
            border-radius: 12px;
            font-size: 12px;
            color: var(--primary-color);
            margin-bottom: 8px;
        }

        .delete-btn {
            position: absolute;
            right: 15px;
            top: 15px;
            background: var(--danger-color);
            padding: 4px 8px;
            font-size: 12px;
            width: auto;
        }

        .content-preview {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            font-family: monospace;
            white-space: pre-wrap;
            margin-top: 10px;
            font-size: 13px;
        }

        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
            }
            
            .tools-section {
                position: static;
            }
            
            body {
                padding: 10px;
            }
        }

        /* 美化表单样式 */
        .add-form {
            background: linear-gradient(145deg, #ffffff, #f8f9fa);
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.05);
        }

        .form-title {
            color: var(--primary-color);
            font-size: 1.4em;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .form-group {
            margin-bottom: 20px;
            position: relative;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 500;
            font-size: 0.95em;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .form-group label i {
            color: var(--primary-color);
        }

        .form-control {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 15px;
            transition: all 0.3s ease;
            background: white;
        }

        .form-control:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
            outline: none;
        }

        select.form-control {
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23555' viewBox='0 0 16 16'%3E%3Cpath d='M8 11.5l-5-5h10l-5 5z'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 15px center;
            padding-right: 40px;
        }

        textarea.form-control {
            min-height: 120px;
            resize: vertical;
        }

        .submit-btn {
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            width: 100%;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .submit-btn:hover {
            background: #45a049;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(76, 175, 80, 0.2);
        }

        .submit-btn:active {
            transform: translateY(0);
        }

        .submit-btn i {
            font-size: 18px;
        }

        /* 添加动画效果 */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .form-group {
            animation: fadeIn 0.3s ease-out forwards;
        }

        /* 添加表单验证样式 */
        .form-control:invalid {
            border-color: #ff5252;
        }

        .form-control:invalid:focus {
            border-color: #ff5252;
            box-shadow: 0 0 0 3px rgba(255, 82, 82, 0.1);
        }

        /* 添加提示文本样式 */
        .form-text {
            font-size: 0.85em;
            color: #666;
            margin-top: 5px;
        }

        /* 添加加载状态样式 */
        .submit-btn.loading {
            background: #666;
            pointer-events: none;
        }

        .submit-btn.loading i {
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* 添加应用图标样式 */
        .app-icon {
            width: 32px;
            height: 32px;
            margin-right: 10px;
            vertical-align: middle;
        }

        /* 添加自定义图标样式 */
        .custom-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            background: var(--primary-color);
            border-radius: 50%;
            color: white;
            font-size: 14px;
        }

        /* 添加设置按钮样式 */
        .settings-btn {
            position: fixed;
            right: 20px;
            top: 20px;
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 10px;
            border-radius: 50%;
            width: 45px;
            height: 45px;
            cursor: pointer;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
            z-index: 1000;
        }

        .settings-btn:hover {
            transform: rotate(30deg);
            background: #45a049;
        }

        /* 模态框样式 */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1001;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background: white;
            padding: 25px;
            border-radius: 12px;
            width: 90%;
            max-width: 400px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .modal-header h3 {
            margin: 0;
            color: var(--text-color);
        }

        .close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: auto;
        }

        .password-form {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .password-form input {
            width: 100%;
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 6px;
            font-size: 15px;
        }

        .password-form input:focus {
            border-color: var(--primary-color);
            outline: none;
        }

        .password-form button {
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
        }

        .password-form button:hover {
            background: #45a049;
        }

        .form-message {
            text-align: center;
            margin-top: 10px;
            padding: 8px;
            border-radius: 4px;
            display: none;
        }

        .form-message.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }

        .form-message.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }

        /* 删除确认对话框样式 */
        .delete-confirm-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }

        .delete-confirm-content {
            background: white;
            padding: 25px;
            border-radius: 12px;
            width: 90%;
            max-width: 400px;
            text-align: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }

        .delete-confirm-icon {
            color: #dc3545;
            font-size: 48px;
            margin-bottom: 20px;
        }

        .delete-confirm-title {
            font-size: 20px;
            color: #333;
            margin-bottom: 15px;
            font-weight: 600;
        }

        .delete-confirm-message {
            color: #666;
            margin-bottom: 25px;
            line-height: 1.5;
        }

        .delete-confirm-buttons {
            display: flex;
            gap: 10px;
            justify-content: center;
        }

        .delete-confirm-btn {
            padding: 10px 20px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 15px;
            transition: all 0.3s;
        }

        .delete-confirm-btn.cancel {
            background: #f8f9fa;
            color: #333;
        }

        .delete-confirm-btn.confirm {
            background: #dc3545;
            color: white;
        }

        .delete-confirm-btn:hover {
            opacity: 0.9;
            transform: translateY(-1px);
        }

        /* 固定设置按钮样式 */
        .floating-buttons {
            position: fixed;
            right: 20px;
            bottom: 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 1000;
        }

        .floating-btn {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }

        .floating-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }

        .floating-btn.add {
            background: var(--primary-color);
            color: white;
        }

        .floating-btn.settings {
            background: #666;
            color: white;
        }

        .floating-btn.logout {
            background: #dc3545;
            color: white;
        }

        .floating-btn.logout:hover {
            background: #c82333;
        }

        /* 添加工具提示样式 */
        .floating-btn[data-tooltip] {
            position: relative;
        }

        .floating-btn[data-tooltip]::before {
            content: attr(data-tooltip);
            position: absolute;
            right: 100%;
            top: 50%;
            transform: translateY(-50%);
            margin-right: 10px;
            padding: 5px 10px;
            background: rgba(0,0,0,0.8);
            color: white;
            font-size: 12px;
            border-radius: 4px;
            white-space: nowrap;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
        }

        .floating-btn[data-tooltip]:hover::before {
            opacity: 1;
            visibility: visible;
        }

        /* 主题设置面板样式 */
        .theme-settings {
            padding: 20px;
            border-top: 1px solid var(--border-color);
            margin-top: 20px;
        }

        .color-picker-group {
            margin: 15px 0;
        }

        .color-picker-group label {
            display: block;
            margin-bottom: 8px;
            color: #666;
        }

        .color-picker-group input[type="color"] {
            width: 100%;
            height: 40px;
            padding: 2px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
        }

        .image-upload-group {
            margin: 15px 0;
        }

        .image-upload-group label {
            display: block;
            margin-bottom: 8px;
            color: #666;
        }

        .image-preview {
            width: 100%;
            height: 150px;
            border: 2px dashed var(--border-color);
            border-radius: 8px;
            margin-top: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            background-size: cover;
            background-position: center;
            cursor: pointer;
        }

        .image-preview.empty {
            color: #666;
        }

        .theme-preview {
            padding: 15px;
            border-radius: 8px;
            background: var(--background-color);
            margin-top: 15px;
        }

        /* 系统信息样式 */
        .system-info {
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .info-item {
            margin: 10px 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .password-display {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .password-display input {
            background: #fff;
            border: 1px solid #ddd;
            padding: 5px 10px;
            border-radius: 4px;
            font-family: monospace;
        }

        .password-display button {
            background: none;
            border: none;
            cursor: pointer;
            color: #666;
        }

        /* 文件导入按钮样式 */
        .form-actions {
            margin-top: 10px;
        }

        .form-actions button {
            background: none;
            border: 1px solid var(--primary-color);
            color: var(--primary-color);
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s;
        }

        .form-actions button:hover {
            background: var(--primary-color);
            color: white;
        }

        /* 设置分区样式 */
        .settings-section {
            padding: 20px;
            border-bottom: 1px solid #eee;
        }

        .settings-section h4 {
            margin-bottom: 15px;
            color: #333;
        }

        /* 退出按钮样式 */
        .logout-btn {
            position: absolute;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            background: #dc3545;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s;
        }

        .logout-btn:hover {
            background: #c82333;
            transform: translateY(-50%) translateX(-2px);
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }

        /* 修改系统信息样式 */
        .system-info {
            background: #fff3cd;
            border: 1px solid #ffeeba;
            color: #856404;
        }

        .system-info .info-item {
            padding: 8px 0;
            border-bottom: 1px dashed rgba(0,0,0,0.1);
        }

        .system-info .info-item:last-child {
            border-bottom: none;
        }

        .system-info .password-display input {
            color: #533f03;
            font-weight: 500;
            width: 200px;
        }

        .system-info .deploy-time {
            color: #533f03;
            font-family: monospace;
        }

        .system-info h4 {
            color: #533f03;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .system-info h4 i {
            color: #856404;
        }

        /* 初始密码显示样式优化 */
        .initial-password {
            margin-top: 25px;
            padding: 20px;
            background: #fff3cd;
            border: 1px solid #ffeeba;
            border-radius: 8px;
            text-align: center;
            animation: fadeIn 0.5s ease;
        }

        .initial-password .title {
            color: #856404;
            font-size: 16px;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .initial-password .password {
            font-family: monospace;
            font-size: 24px;
            color: #533f03;
            background: rgba(255,255,255,0.5);
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
            user-select: all;
        }

        .initial-password .note {
            color: #666;
            font-size: 14px;
            margin-top: 10px;
        }

        .initial-password .actions {
            margin-top: 15px;
            display: flex;
            justify-content: center;
            gap: 10px;
        }

        .initial-password button {
            background: none;
            border: 1px solid #856404;
            color: #856404;
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s;
        }

        .initial-password button:hover {
            background: #856404;
            color: white;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* 登录表单美化 */
        .login-form {
            margin-top: 30px;
        }

        .login-form .form-group {
            margin-bottom: 20px;
        }

        .login-form input {
            width: 100%;
            padding: 12px 15px 12px 45px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s;
        }

        .login-form input:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
        }

        .login-btn {
            width: 100%;
            padding: 12px;
            background: var(--primary-color);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .login-btn:hover {
            background: #45a049;
            transform: translateY(-1px);
        }

        /* 退出按钮样式 */
        .header-actions {
            position: absolute;
            top: 20px;
            right: 20px;
            display: flex;
            gap: 10px;
        }

        .logout-btn {
            background: #dc3545;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s;
        }

        .logout-btn:hover {
            background: #c82333;
            transform: translateY(-1px);
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }

        .logout-btn:active {
            transform: translateY(0);
        }

        /* 设置面板中的退出按钮样式 */
        .settings-footer {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            text-align: center;
        }

        .settings-footer .logout-btn {
            background: #dc3545;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s;
        }

        .settings-footer .logout-btn:hover {
            background: #c82333;
            transform: translateY(-1px);
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }

        .settings-footer .logout-btn i {
            font-size: 16px;
        }

        /* 密码生成器样式 */
        .password-generator {
            background: linear-gradient(145deg, #ffffff, #f8f9fa);
        }

        .generator-content {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .password-display {
            position: relative;
            margin-top: 10px;
        }

        .password-display input {
            width: 100%;
            padding: 12px 45px 12px 15px;
            font-family: monospace;
            font-size: 16px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            background: #fff;
            transition: all 0.3s;
        }

        .password-display input:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
        }

        .password-display .copy-btn {
            position: absolute;
            right: 5px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: #666;
            padding: 8px;
            cursor: pointer;
            transition: all 0.3s;
        }

        .password-display .copy-btn:hover {
            color: var(--primary-color);
        }

        .length-control {
            margin: 15px 0;
        }

        .length-control label {
            display: block;
            margin-bottom: 10px;
            color: #666;
        }

        .range-slider {
            width: 100%;
            height: 6px;
            background: #e0e0e0;
            border-radius: 3px;
            outline: none;
            -webkit-appearance: none;
        }

        .range-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 18px;
            height: 18px;
            background: var(--primary-color);
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.3s;
        }

        .range-slider::-webkit-slider-thumb:hover {
            transform: scale(1.1);
        }

        .options-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
        }

        .checkbox-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
        }

        .checkbox-wrapper input[type="checkbox"] {
            width: 16px;
            height: 16px;
            margin: 0;
        }

        .checkbox-label {
            display: flex;
            align-items: center;
            gap: 6px;
            color: #666;
            font-size: 14px;
        }

        .checkbox-label i {
            color: var(--primary-color);
            width: 16px;
        }

        .generate-btn {
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 12px;
            border-radius: 8px;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            cursor: pointer;
            transition: all 0.3s;
            margin-top: 10px;
        }

        .generate-btn:hover {
            background: #45a049;
            transform: translateY(-1px);
        }

        .generate-btn i {
            transition: transform 0.3s;
        }

        .generate-btn:hover i {
            transform: rotate(180deg);
        }

        /* 图片上传区域样式 */
        .setting-item {
            margin-bottom: 20px;
        }

        .setting-item label {
            display: block;
            margin-bottom: 10px;
            color: #666;
            font-weight: 500;
        }

        .image-upload-area {
            border: 2px dashed #ddd;
            border-radius: 8px;
            padding: 15px;
            text-align: center;
            transition: all 0.3s;
        }

        .image-upload-area:hover {
            border-color: var(--primary-color);
        }

        .image-preview {
            width: 100%;
            height: 200px;
            background: #f8f9fa;
            border-radius: 4px;
            cursor: pointer;
            overflow: hidden;
            position: relative;
        }

        .preview-content {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #666;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }

        .preview-content i {
            font-size: 40px;
            color: #999;
        }

        #bgPreview {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .image-actions {
            margin-top: 10px;
            display: flex;
            justify-content: center;
        }

        .remove-image {
            background: #dc3545;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            transition: all 0.3s;
        }

        .remove-image:hover {
            background: #c82333;
        }

        /* 拖放效果 */
        .image-upload-area.dragover {
            border-color: var(--primary-color);
            background: rgba(76, 175, 80, 0.05);
        }

        /* 退出确认对话框样式 */
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            animation: fadeIn 0.3s ease;
        }

        .modal-content {
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            width: 90%;
            max-width: 500px;
            animation: slideIn 0.3s ease;
        }

        .modal-header {
            padding: 20px;
            border-bottom: 1px solid #eee;
        }

        .modal-header h3 {
            margin: 0;
            display: flex;
            align-items: center;
            gap: 10px;
            color: #333;
        }

        .modal-body {
            padding: 20px;
        }

        .modal-footer {
            padding: 20px;
            border-top: 1px solid #eee;
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }

        .cancel-btn {
            background: #f8f9fa;
            color: #333;
            border: 1px solid #ddd;
            padding: 8px 20px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s;
        }

        .cancel-btn:hover {
            background: #e9ecef;
        }

        .confirm-btn {
            background: #dc3545;
            color: white;
            border: none;
            padding: 8px 20px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s;
        }

        .confirm-btn:hover {
            background: #c82333;
            transform: translateY(-1px);
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes slideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }

        /* 添加提示样式 */
        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            border-radius: 6px;
            background: white;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            opacity: 0;
            transform: translateY(-20px);
            transition: all 0.3s ease;
        }

        .toast.show {
            opacity: 1;
            transform: translateY(0);
        }

        .toast-success {
            background: #4CAF50;
            color: white;
        }

        .toast-error {
            background: #f44336;
            color: white;
        }

        .toast-info {
            background: #2196F3;
            color: white;
        }
    </style>
</head>
<body>
    <div class="page-container">
        <!-- 浮动按钮组 -->
        <div class="floating-buttons">
            <button class="floating-btn add" data-tooltip="添加新条目" onclick="showAddForm()">
                <i class="fas fa-plus"></i>
            </button>
            <button class="floating-btn settings" data-tooltip="系统设置" onclick="openSettings()">
                <i class="fas fa-cog"></i>
            </button>
            <button class="floating-btn logout" data-tooltip="退出登录" onclick="logout()">
                <i class="fas fa-sign-out-alt"></i>
            </button>
        </div>

        <div class="header">
            <h1>
                <svg class="header-icon" viewBox="0 0 24 24">
                    <path d="M12 1C8.676 1 6 3.676 6 7v3H4v12h16V10h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v3H8V7c0-2.276 1.724-4 4-4z"/>
                    <circle cx="12" cy="15" r="2"/>
                </svg>
                密码与密钥管理器
            </h1>
        </div>

        <div class="main-content">
            <!-- 左侧内容区 -->
            <div class="content-section">
                <div class="items-list" id="items">
                    <!-- 项目列表将通过 JavaScript 动态插入 -->
                </div>
            </div>

            <!-- 右侧工具区 -->
            <div class="tools-section">
                <!-- 添加新条目工具 -->
                <div class="tool-card add-form">
                    <h3 class="form-title">
                        <i class="fas fa-plus-circle"></i>
                        添加新条目
                    </h3>
                    <form id="addForm">
                        <div class="form-group">
                            <label>
                                <i class="fas fa-globe"></i>
                                选择平台类型
                            </label>
                            <select class="form-control" id="platform" required>
                                <option value="">请选择平台类型...</option>
                                <option value="网站">🌐 网站账号</option>
                                <option value="应用">📱 移动应用</option>
                                <option value="游戏">🎮 游戏平台</option>
                                <option value="邮箱">📧 电子邮箱</option>
                                <option value="社交媒体">💬 社交媒体</option>
                                <option value="开发平台">💻 开发平台</option>
                                <option value="支付">💳 支付账户</option>
                                <option value="云服务">☁️ 云服务</option>
                                <option value="其他">📝 其他</option>
                            </select>
                            <div class="form-text">选择适合的平台类型以便更好地组织</div>
                        </div>

                        <div class="form-group">
                            <label>
                                <i class="fas fa-tag"></i>
                                标题
                            </label>
                            <input type="text" 
                                   class="form-control" 
                                   id="title" 
                                   placeholder="例如：GitHub账号"
                                   required
                                   minlength="2"
                                   maxlength="50">
                            <div class="form-text">添加一个容易识别的标题</div>
                        </div>

                        <div class="form-group">
                            <label>
                                <i class="fas fa-lock"></i>
                                内容
                            </label>
                            <textarea class="form-control" 
                                      id="content" 
                                      placeholder="在这里输入账号、密码等信息..."
                                      required
                                      minlength="1"
                                      maxlength="1000"></textarea>
                            <div class="form-text">可以包含账号、密码、密钥等信息</div>
                        </div>

                        <button type="submit" class="submit-btn" id="submitBtn">
                            <i class="fas fa-save"></i>
                            保存信息
                        </button>
                    </form>
                </div>

                <!-- 密码生成器工具 -->
                <div class="tool-card password-generator">
                    <h3><i class="fas fa-magic"></i> 密码生成器</h3>
                    <div class="generator-content">
                        <div class="password-display">
                            <input type="text" id="generatedPassword" readonly placeholder="点击生成密码">
                            <button class="copy-btn" onclick="copyGeneratedPassword()" title="复制密码">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>

                        <div class="length-control">
                            <label>密码长度: <span id="lengthValue">12</span> 位</label>
                            <input type="range" 
                                   id="length" 
                                   min="8" 
                                   max="32" 
                                   value="12"
                                   class="range-slider">
                        </div>

                        <div class="options-grid">
                            <label class="checkbox-wrapper">
                                <input type="checkbox" id="uppercase" checked>
                                <span class="checkbox-label">
                                    <i class="fas fa-font"></i>
                                    大写字母 (A-Z)
                                </span>
                            </label>
                            <label class="checkbox-wrapper">
                                <input type="checkbox" id="lowercase" checked>
                                <span class="checkbox-label">
                                    <i class="fas fa-font" style="font-size: 0.8em;"></i>
                                    小写字母 (a-z)
                                </span>
                            </label>
                            <label class="checkbox-wrapper">
                                <input type="checkbox" id="numbers" checked>
                                <span class="checkbox-label">
                                    <i class="fas fa-hashtag"></i>
                                    数字 (0-9)
                                </span>
                            </label>
                            <label class="checkbox-wrapper">
                                <input type="checkbox" id="symbols">
                                <span class="checkbox-label">
                                    <i class="fas fa-at"></i>
                                    特殊符号 (!@#$)
                                </span>
                            </label>
                        </div>

                        <button class="generate-btn" onclick="generatePassword()">
                            <i class="fas fa-sync-alt"></i>
                            生成密码
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 密码修改对话框 -->
        <div class="modal" id="settingsModal">
            <div class="modal-content" style="max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h3><i class="fas fa-cog"></i> 设置</h3>
                    <button class="close-btn" onclick="closeSettings()">&times;</button>
                </div>

                <!-- 密码修改部分 -->
                <div class="settings-section">
                    <h4>修改密码</h4>
                    <form class="password-form" id="passwordForm">
                        <input type="password" id="currentPassword" placeholder="当前密码" required>
                        <input type="password" id="newPassword" placeholder="新密码" required minlength="8">
                        <input type="password" id="confirmPassword" placeholder="确认新密码" required>
                        <button type="submit">更新密码</button>
                    </form>
                    <div id="formMessage" class="form-message"></div>
                </div>

                <!-- 主题设置部分 -->
                <div class="theme-settings">
                    <h4>主题设置</h4>
                    
                    <!-- 添加登录背景设置 -->
                    <div class="setting-item">
                        <label>登录页面背景图片</label>
                        <div class="image-upload-area" id="loginBgUpload">
                            <input type="file" id="bgImageInput" accept="image/*" style="display: none" onchange="handleBgImageUpload(event)">
                            <div class="image-preview empty" id="imagePreview" onclick="document.getElementById('bgImageInput').click()">
                                <div class="preview-content">
                                    <i class="fas fa-cloud-upload-alt"></i>
                                    <span>点击上传或拖放图片</span>
                                </div>
                                <img id="bgPreview" style="display: none">
                            </div>
                            <div class="image-actions">
                                <button type="button" class="remove-image" onclick="removeBgImage()" style="display: none">
                                    <i class="fas fa-trash-alt"></i> 移除图片
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="color-picker-group">
                        <label>主题色</label>
                        <input type="color" id="primaryColor" value="#4CAF50" onchange="updateThemeColor(this.value)">
                    </div>

                    <div class="color-picker-group">
                        <label>背景色</label>
                        <input type="color" id="backgroundColor" value="#f5f5f5" onchange="updateBackgroundColor(this.value)">
                    </div>
                </div>
            </div>
        </div>

        <!-- 添加删除确认对话框 -->
        <div class="delete-confirm-modal" id="deleteConfirmModal">
            <div class="delete-confirm-content">
                <div class="delete-confirm-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <div class="delete-confirm-title">确认删除</div>
                <div class="delete-confirm-message">
                    此操作将永久删除该条目，删除后无法恢复。<br>
                    请确认是否继续？
                </div>
                <div class="delete-confirm-buttons">
                    <button class="delete-confirm-btn cancel" onclick="closeDeleteConfirm()">
                        取消
                    </button>
                    <button class="delete-confirm-btn confirm" id="confirmDeleteBtn">
                        确认删除
                    </button>
                </div>
            </div>
        </div>

        <!-- 添加文本上传对话框 -->
        <div class="modal" id="addFormModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-plus"></i> 添加新条目</h3>
                    <button class="close-btn" onclick="closeAddForm()">&times;</button>
                </div>
                <form id="addForm" class="add-form">
                    <div class="form-group">
                        <label>选择平台类型</label>
                        <select id="platform" required>
                            <option value="">请选择平台类型...</option>
                            <option value="网站">网站</option>
                            <option value="应用">应用</option>
                            <option value="游戏">游戏</option>
                            <option value="邮箱">邮箱</option>
                            <option value="社交媒体">社交媒体</option>
                            <option value="开发平台">开发平台</option>
                            <option value="支付">支付</option>
                            <option value="云服务">云服务</option>
                            <option value="其他">其他</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>标题</label>
                        <input type="text" id="title" placeholder="例如: GitHub账号" required>
                    </div>
                    <div class="form-group">
                        <label>内容</label>
                        <textarea id="content" placeholder="在这里输入账号、密码等信息..." required></textarea>
                        <div class="form-actions">
                            <button type="button" onclick="importFromFile()">
                                <i class="fas fa-file-import"></i> 从文件导入
                            </button>
                            <input type="file" id="fileInput" style="display: none" accept=".txt">
                        </div>
                    </div>
                    <button type="submit" class="submit-btn">
                        <i class="fas fa-save"></i> 保存信息
                    </button>
                </form>
            </div>
        </div>
    </div>

    <!-- 修改初始密码显示区域 -->
    <div id="initialPassword" class="initial-password" style="display: none;">
        <div class="title">
            <i class="fas fa-key"></i>
            系统分配的登录密码
        </div>
        <div class="password" id="generatedPassword"></div>
        <div class="note">
            请务必保存此密码，此提示仅显示一次。<br>
            登录后可在设置中查看和修改密码。
        </div>
        <div class="actions">
            <button onclick="copyInitialPassword()">
                <i class="fas fa-copy"></i>
                复制密码
            </button>
            <button onclick="hideInitialPassword()">
                <i class="fas fa-check"></i>
                我已保存
            </button>
        </div>
    </div>

    <!-- 添加退出确认对话框 -->
    <div class="modal" id="logoutConfirmModal" style="display: none;">
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h3><i class="fas fa-sign-out-alt"></i> 退出确认</h3>
            </div>
            <div class="modal-body" style="text-align: center; padding: 20px;">
                <div style="font-size: 18px; margin-bottom: 15px;">
                    <i class="fas fa-question-circle" style="color: #f0ad4e; font-size: 24px; margin-right: 10px;"></i>
                    确定要退出登录吗？
                </div>
                <div style="color: #666; font-size: 14px;">
                    退出后需要重新输入密码才能访问
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: center; gap: 10px; padding-top: 20px;">
                <button class="cancel-btn" onclick="closeLogoutConfirm()">
                    <i class="fas fa-times"></i> 取消
                </button>
                <button class="confirm-btn" onclick="confirmLogout()">
                    <i class="fas fa-sign-out-alt"></i> 确认退出
                </button>
            </div>
        </div>
    </div>

    <script>
        const PLATFORM_ICONS = {
            '网站': 'fas fa-globe',
            '应用': 'fas fa-mobile-alt',
            '游戏': 'fas fa-gamepad',
            '邮箱': 'fas fa-envelope',
            '社交媒体': 'fas fa-comments',
            '开发平台': 'fas fa-code',
            '支付': 'fas fa-credit-card',
            '云服务': 'fas fa-cloud',
            '其他': 'fas fa-folder'
        };

        async function loadItems() {
            try {
                const response = await fetch('/api/items');
                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || '加载失败');
                }
                const items = await response.json();
                const itemsDiv = document.getElementById('items');
                
                if (items.length === 0) {
                    itemsDiv.innerHTML = '<div class="item">暂无数据</div>';
                    return;
                }

                itemsDiv.innerHTML = items.map(function(item) {
                    const icon = getPlatformIcon(item.platform);
                    return \`
                        <div class="item">
                            <button class="delete-btn" onclick="showDeleteConfirm('\${item.id}')">
                                <i class="fas fa-trash"></i> 删除
                            </button>
                            <span class="platform-tag">
                                <i class="fas fa-\${icon}"></i>
                                \${item.platform || '未分类'}
                            </span>
                            <h4>\${escapeHtml(item.title)}</h4>
                            <div class="content-preview">\${escapeHtml(item.content)}</div>
                        </div>
                    \`;
                }).join('');
            } catch (error) {
                console.error('加载失败:', error);
                alert(error.message || '加载数据失败，请检查配置并刷新页面');
            }
        }

        function getPlatformIcon(platform) {
            const icons = {
                '网站': 'globe',
                '应用': 'mobile-alt',
                '游戏': 'gamepad',
                '邮箱': 'envelope',
                '社交媒体': 'comments',
                '开发平台': 'code',
                '支付': 'credit-card',
                '云服务': 'cloud',
                '其他': 'folder'
            };
            return icons[platform] || 'folder';
        }

        function escapeHtml(unsafe) {
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        // 修改删除相关函数
        let itemToDelete = null;

        function showDeleteConfirm(id) {
            itemToDelete = id;
            document.getElementById('deleteConfirmModal').style.display = 'flex';
        }

        function closeDeleteConfirm() {
            itemToDelete = null;
            document.getElementById('deleteConfirmModal').style.display = 'none';
        }

        // 修改删除按钮的事件处理
        async function deleteItem(id) {
            try {
                const response = await fetch('/api/items/' + id, {
                    method: 'DELETE'
                });
                if (!response.ok) {
                    throw new Error('删除失败');
                }
                await loadItems();
                closeDeleteConfirm();
            } catch (error) {
                console.error('删除失败:', error);
                alert('删除失败，请重试');
            }
        }

        // 添加确认删除按钮事件监听
        document.getElementById('confirmDeleteBtn').onclick = function() {
            if (itemToDelete) {
                deleteItem(itemToDelete);
            }
        };

        // 点击模态框外部关闭
        document.getElementById('deleteConfirmModal').onclick = function(event) {
            if (event.target === this) {
                closeDeleteConfirm();
            }
        };

        document.getElementById('addForm').onsubmit = async function(e) {
            e.preventDefault();
            const submitBtn = document.getElementById('submitBtn');
            
            try {
                submitBtn.classList.add('loading');
                submitBtn.innerHTML = '<i class="fas fa-spinner"></i> 保存中...';
                
                const platform = document.getElementById('platform').value;
                const title = document.getElementById('title').value;
                const content = document.getElementById('content').value;
                
                const response = await fetch('/api/items', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ platform, title, content })
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || '保存失败');
                }

                // 清空表单
                this.reset();
                await loadItems();
                
                // 显示成功提示
                submitBtn.innerHTML = '<i class="fas fa-check"></i> 保存成功';
                submitBtn.style.background = '#4CAF50';
                
                setTimeout(() => {
                    submitBtn.classList.remove('loading');
                    submitBtn.innerHTML = '<i class="fas fa-save"></i> 保存信息';
                }, 2000);
                
            } catch (error) {
                console.error('保存失败:', error);
                submitBtn.innerHTML = '<i class="fas fa-exclamation-circle"></i> 保存失败';
                submitBtn.style.background = '#f44336';
                alert(error.message || '保存失败，请重试');
                
                setTimeout(() => {
                    submitBtn.classList.remove('loading');
                    submitBtn.innerHTML = '<i class="fas fa-save"></i> 保存信息';
                    submitBtn.style.background = '';
                }, 2000);
            }
        };

        // 修改密码生成相关函数
        function generatePassword() {
            const length = document.getElementById('length').value;
            const hasUpper = document.getElementById('uppercase').checked;
            const hasLower = document.getElementById('lowercase').checked;
            const hasNumbers = document.getElementById('numbers').checked;
            const hasSymbols = document.getElementById('symbols').checked;

            if (!hasUpper && !hasLower && !hasNumbers && !hasSymbols) {
                alert('请至少选择一种字符类型');
                return;
            }

            const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const lower = 'abcdefghijklmnopqrstuvwxyz';
            const numbers = '0123456789';
            const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

            let chars = '';
            if (hasUpper) chars += upper;
            if (hasLower) chars += lower;
            if (hasNumbers) chars += numbers;
            if (hasSymbols) chars += symbols;

            let password = '';
            for (let i = 0; i < length; i++) {
                password += chars.charAt(Math.floor(Math.random() * chars.length));
            }

            const input = document.getElementById('generatedPassword');
            input.value = password;
            input.select();
        }

        // 添加复制功能
        function copyGeneratedPassword() {
            const input = document.getElementById('generatedPassword');
            if (!input.value) {
                alert('请先生成密码');
                return;
            }
            
            input.select();
            document.execCommand('copy');
            
            const btn = document.querySelector('.copy-btn');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i>';
            btn.style.color = '#28a745';
            
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.color = '';
            }, 2000);
        }

        // 更新长度显示
        document.getElementById('length').addEventListener('input', function(e) {
            document.getElementById('lengthValue').textContent = e.target.value;
        });

        document.addEventListener('DOMContentLoaded', function() {
            loadItems().catch(function(error) {
                console.error('初始化失败:', error);
            });
        });

        // 注册 Service Worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js').then(function(registration) {
                    console.log('ServiceWorker 注册成功');
                }).catch(function(err) {
                    console.log('ServiceWorker 注册失败: ', err);
                });
            });
        }

        // 添加设置相关函数
        function openSettings() {
            document.getElementById('settingsModal').style.display = 'flex';
        }

        function closeSettings() {
            document.getElementById('settingsModal').style.display = 'none';
            document.getElementById('passwordForm').reset();
            document.getElementById('formMessage').style.display = 'none';
        }

        // 添加密码修改处理
        document.getElementById('passwordForm').onsubmit = async function(e) {
            e.preventDefault();
            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const messageEl = document.getElementById('formMessage');

            if (newPassword !== confirmPassword) {
                messageEl.textContent = '新密码与确认密码不匹配';
                messageEl.className = 'form-message error';
                messageEl.style.display = 'block';
                return;
            }

            try {
                const response = await fetch('/api/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        currentPassword,
                        newPassword
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    messageEl.textContent = '密码修改成功';
                    messageEl.className = 'form-message success';
                    messageEl.style.display = 'block';
                    
                    // 更新系统信息显示
                    document.getElementById('currentSystemPassword').value = newPassword;
                    
                    // 清空表单
                    this.reset();
                    
                    // 3秒后隐藏消息
                    setTimeout(() => {
                        messageEl.style.display = 'none';
                    }, 3000);
                } else {
                    messageEl.textContent = data.error || '密码修改失败';
                    messageEl.className = 'form-message error';
                    messageEl.style.display = 'block';
                }
            } catch (error) {
                console.error('密码修改失败:', error);
                messageEl.textContent = '发生错误，请重试';
                messageEl.className = 'form-message error';
                messageEl.style.display = 'block';
            }
        };

        // 点击模态框外部关闭
        window.onclick = function(event) {
            if (event.target == document.getElementById('settingsModal')) {
                closeSettings();
            }
        }

        // 添加主题相关函数
        async function updateThemeColor(color) {
            document.documentElement.style.setProperty('--primary-color', color);
            await saveThemeSettings();
        }

        async function updateBackgroundColor(color) {
            document.documentElement.style.setProperty('--background-color', color);
            await saveThemeSettings();
        }

        async function handleImageUpload(input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = async function(e) {
                    const imagePreview = document.getElementById('imagePreview');
                    imagePreview.style.backgroundImage = \`url(\${e.target.result})\`;
                    imagePreview.classList.remove('empty');
                    imagePreview.innerHTML = '';
                    
                    // 保存图片数据
                    await saveThemeSettings({
                        loginBgImage: e.target.result
                    });
                };
                reader.readAsDataURL(file);
            }
        }

        async function saveThemeSettings(additionalSettings = {}) {
            const settings = {
                primaryColor: document.getElementById('primaryColor').value,
                backgroundColor: document.getElementById('backgroundColor').value,
                ...additionalSettings
            };

            try {
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(settings)
                });
            } catch (error) {
                console.error('保存设置失败:', error);
            }
        }

        async function loadThemeSettings() {
            try {
                const response = await fetch('/api/settings');
                if (response.ok) {
                    const settings = await response.json();
                    if (settings.primaryColor) {
                        document.getElementById('primaryColor').value = settings.primaryColor;
                        document.documentElement.style.setProperty('--primary-color', settings.primaryColor);
                    }
                    if (settings.backgroundColor) {
                        document.getElementById('backgroundColor').value = settings.backgroundColor;
                        document.documentElement.style.setProperty('--background-color', settings.backgroundColor);
                    }
                    if (settings.loginBgImage) {
                        const imagePreview = document.getElementById('imagePreview');
                        imagePreview.style.backgroundImage = \`url(\${settings.loginBgImage})\`;
                        imagePreview.classList.remove('empty');
                        imagePreview.innerHTML = '';
                    }
                    if (settings.currentPassword) {
                        document.getElementById('currentSystemPassword').value = settings.currentPassword;
                    }
                    if (settings.deployTime) {
                        const deployDate = new Date(settings.deployTime);
                        document.getElementById('deployTime').textContent = deployDate.toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        });
                    }
                }
            } catch (error) {
                console.error('加载设置失败:', error);
            }
        }

        // 页面加载时初始化主题设置
        document.addEventListener('DOMContentLoaded', function() {
            loadThemeSettings();
        });

        function showAddForm() {
            document.getElementById('addFormModal').style.display = 'flex';
        }

        // 添加密码显示切换功能
        function togglePasswordVisibility() {
            const input = document.getElementById('currentSystemPassword');
            const icon = document.querySelector('.password-display button i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.className = 'fas fa-eye-slash';
            } else {
                input.type = 'password';
                icon.className = 'fas fa-eye';
            }
        }

        // 添加文件导入功能
        function importFromFile() {
            document.getElementById('fileInput').click();
        }

        document.getElementById('fileInput').onchange = function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById('content').value = e.target.result;
                };
                reader.readAsText(file);
            }
        }

        // 添加表单关闭功能
        function closeAddForm() {
            document.getElementById('addFormModal').style.display = 'none';
            document.getElementById('addForm').reset();
        }

        // 添加退出功能
        async function logout() {
            document.getElementById('logoutConfirmModal').style.display = 'flex';
        }

        // 关闭退出确认对话框
        function closeLogoutConfirm() {
            document.getElementById('logoutConfirmModal').style.display = 'none';
        }

        // 确认退出
        async function confirmLogout() {
            try {
                // 禁用退出按钮，显示加载状态
                const confirmBtn = document.querySelector('.confirm-btn');
                const cancelBtn = document.querySelector('.cancel-btn');
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 退出中...';
                }
                if (cancelBtn) {
                    cancelBtn.disabled = false;
                }

                // 发送退出请求
                const response = await fetch('/api/logout', {
                    method: 'POST',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                });

                if (!response.ok) {
                    throw new Error('退出请求失败');
                }

                // 清除本地数据
                try {
                    // 清除本地存储
                    localStorage.clear();
                    sessionStorage.clear();
                    
                    // 清除所有缓存
                    if ('caches' in window) {
                        const cacheKeys = await caches.keys();
                        await Promise.all(
                            cacheKeys.map(key => caches.delete(key))
                        );
                    }

                    // 注销 Service Worker
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        await Promise.all(
                            registrations.map(registration => registration.unregister())
                        );
                    }
                } catch (e) {
                    console.error('清除缓存失败:', e);
                }

                // 立即跳转到登录页面
                window.location.replace('/');
            } catch (error) {
                console.error('退出失败:', error);
                
                // 恢复按钮状态
                const confirmBtn = document.querySelector('.confirm-btn');
                const cancelBtn = document.querySelector('.cancel-btn');
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 确认退出';
                }
                if (cancelBtn) {
                    cancelBtn.disabled = false;
                }

                // 显示错误提示
                showToast('退出失败，请刷新页面重试', 'error');
            }
        }

        // 点击模态框外部关闭
        document.getElementById('logoutConfirmModal').onclick = function(event) {
            if (event.target === this) {
                closeLogoutConfirm();
            }
        };

        // 添加密码复制功能
        async function copyPassword() {
            const input = document.getElementById('currentSystemPassword');
            const originalType = input.type;
            input.type = 'text';
            input.select();
            document.execCommand('copy');
            input.type = originalType;
            
            // 显示复制成功提示
            const button = event.currentTarget;
            const originalHTML = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i>';
            button.style.color = '#28a745';
            
            setTimeout(() => {
                button.innerHTML = originalHTML;
                button.style.color = '';
            }, 2000);
        }

        // 添加密码复制功能
        function copyInitialPassword() {
            const password = document.getElementById('generatedPassword').textContent;
            navigator.clipboard.writeText(password).then(() => {
                const button = event.currentTarget;
                const originalHTML = button.innerHTML;
                button.innerHTML = '<i class="fas fa-check"></i> 已复制';
                setTimeout(() => {
                    button.innerHTML = originalHTML;
                }, 2000);
            });
        }

        // 隐藏初始密码显示
        function hideInitialPassword() {
            document.getElementById('initialPassword').style.display = 'none';
            // 将密码保存状态记录到 localStorage
            localStorage.setItem('passwordShown', 'true');
        }

        // 检查是否需要显示初始密码
        async function checkInitialPassword() {
            try {
                const response = await fetch('/api/check-setup');
                const data = await response.json();
                
                if (data.isFirstTime && data.password && !localStorage.getItem('passwordShown')) {
                    document.getElementById('generatedPassword').textContent = data.password;
                    document.getElementById('initialPassword').style.display = 'block';
                }
            } catch (error) {
                console.error('检查初始密码失败:', error);
            }
        }

        // 页面加载时检查初始密码
        document.addEventListener('DOMContentLoaded', function() {
            checkInitialPassword();
        });

        // 添加背景图片相关函数
        async function handleBgImageUpload(event) {
            const file = event.target.files[0];
            if (file) {
                if (file.size > 5 * 1024 * 1024) { // 5MB 限制
                    alert('图片大小不能超过 5MB');
                    return;
                }

                const reader = new FileReader();
                reader.onload = async function(e) {
                    const preview = document.getElementById('bgPreview');
                    preview.src = e.target.result;
                    preview.style.display = 'block';
                    document.querySelector('.preview-content').style.display = 'none';
                    document.querySelector('.remove-image').style.display = 'inline-flex';

                    // 保存图片到设置
                    try {
                        const response = await fetch('/api/settings', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                loginBgImage: e.target.result
                            })
                        });

                        if (!response.ok) {
                            throw new Error('保存失败');
                        }
                    } catch (error) {
                        console.error('保存背景图片失败:', error);
                        alert('保存背景图片失败，请重试');
                    }
                };
                reader.readAsDataURL(file);
            }
        }

        async function removeBgImage() {
            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        loginBgImage: null
                    })
                });

                if (!response.ok) {
                    throw new Error('移除失败');
                }

                // 重置预览
                document.getElementById('bgPreview').style.display = 'none';
                document.querySelector('.preview-content').style.display = 'flex';
                document.querySelector('.remove-image').style.display = 'none';
                document.getElementById('bgImageInput').value = '';
            } catch (error) {
                console.error('移除背景图片失败:', error);
                alert('移除背景图片失败，请重试');
            }
        }

        // 添加拖放支持
        const uploadArea = document.getElementById('loginBgUpload');
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                const event = { target: { files: [file] } };
                handleBgImageUpload(event);
            }
        });

        // 加载已保存的背景图片
        async function loadSavedBgImage() {
            try {
                const response = await fetch('/api/settings');
                if (response.ok) {
                    const settings = await response.json();
                    if (settings.loginBgImage) {
                        const preview = document.getElementById('bgPreview');
                        preview.src = settings.loginBgImage;
                        preview.style.display = 'block';
                        document.querySelector('.preview-content').style.display = 'none';
                        document.querySelector('.remove-image').style.display = 'inline-flex';
                    }
                }
            } catch (error) {
                console.error('加载背景图片失败:', error);
            }
        }

        // 页面加载时初始化
        document.addEventListener('DOMContentLoaded', loadSavedBgImage);

        // 添加 handleSettings 函数
        async function handleSettings(request) {
            try {
                // 验证 KV 存储
                if (!request.env?.KV) {
                    throw new Error('KV 存储未配置');
                }

                if (request.method === 'GET') {
                    try {
                        const settingsStr = await request.env.KV.get('app:settings');
                        const settings = settingsStr ? JSON.parse(settingsStr) : {
                            theme: {
                                primaryColor: '#4CAF50',
                                backgroundColor: '#f5f5f5'
                            }
                        };

                        return new Response(JSON.stringify({
                            success: true,
                            settings: settings
                        }), {
                            headers: {
                                'Content-Type': 'application/json',
                                'Cache-Control': 'no-store',
                                'Access-Control-Allow-Origin': '*'
                            }
                        });
                    } catch (error) {
                        console.error('获取设置失败:', error);
                        throw error;
                    }
                }

                if (request.method === 'POST') {
                    try {
                        const newSettings = await request.json();
                        
                        // 验证背景图片大小
                        if (newSettings.loginBgImage) {
                            const base64Data = newSettings.loginBgImage.split(',')[1];
                            const imageSize = base64Data.length * 0.75; // 转换为字节大小
                            if (imageSize > 5 * 1024 * 1024) { // 5MB 限制
                                throw new Error('背景图片不能超过 5MB');
                            }
                        }

                        // 获取当前设置
                        let currentSettings = {};
                        const currentSettingsStr = await request.env.KV.get('app:settings');
                        if (currentSettingsStr) {
                            try {
                                currentSettings = JSON.parse(currentSettingsStr);
                            } catch (e) {
                                console.error('解析当前设置失败:', e);
                            }
                        }

                        // 合并设置
                        const updatedSettings = {
                            ...currentSettings,
                            ...newSettings,
                            lastUpdated: new Date().toISOString()
                        };

                        // 保存设置到 KV
                        try {
                            await request.env.KV.put('app:settings', JSON.stringify(updatedSettings));
                        } catch (error) {
                            console.error('保存设置到 KV 失败:', error);
                            throw new Error('保存设置失败');
                        }

                        return new Response(JSON.stringify({
                            success: true,
                            settings: updatedSettings
                        }), {
                            headers: {
                                'Content-Type': 'application/json',
                                'Cache-Control': 'no-store',
                                'Access-Control-Allow-Origin': '*'
                            }
                        });
                    } catch (error) {
                        console.error('处理设置更新失败:', error);
                        throw error;
                    }
                }

                throw new Error('不支持的请求方法');
            } catch (error) {
                console.error('设置处理错误:', error);
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message || '设置处理失败',
                    details: error.stack
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
        }

        // 修改 handleRequest 函数中的路由处理
        async function handleRequest(request) {
            try {
                const url = new URL(request.url);
                const path = url.pathname;

                // 检查是否已登录
                const sessionToken = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
                const isLoggedIn = await validateSession(request, sessionToken);

                // API 路由处理
                if (path.startsWith('/api/')) {
                    // 需要登录的 API
                    if (!isLoggedIn && path !== '/api/settings') {
                        return new Response(JSON.stringify({
                            success: false,
                            error: '未登录或会话已过期'
                        }), {
                            status: 401,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    // 处理各种 API 请求
                    if (path === '/api/items') {
                        if (request.method === 'GET') {
                            try {
                                const items = await listItems(request);
                                return new Response(JSON.stringify({
                                    success: true,
                                    items: items
                                }), {
                                    headers: { 
                                        'Content-Type': 'application/json',
                                        'Cache-Control': 'no-store'
                                    }
                                });
                            } catch (error) {
                                return new Response(JSON.stringify({
                                    success: false,
                                    error: '获取列表失败',
                                    details: error.message
                                }), {
                                    status: 500,
                                    headers: { 'Content-Type': 'application/json' }
                                });
                            }
                        } else if (request.method === 'POST') {
                            try {
                                const item = await request.json();
                                const newItem = await createItem(request, item);
                                
                                // 返回成功响应
                                return new Response(JSON.stringify({
                                    success: true,
                                    message: '添加成功',
                                    item: newItem
                                }), {
                                    headers: { 
                                        'Content-Type': 'application/json',
                                        'Cache-Control': 'no-store'
                                    }
                                });
                            } catch (error) {
                                console.error('添加条目失败:', error);
                                return new Response(JSON.stringify({
                                    success: false,
                                    error: error.message || '添加失败',
                                    details: error.stack
                                }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json' }
                                });
                            }
                        }
                    }
                }

                // Service Worker 请求
                if (path === '/sw.js') {
                    return new Response(SERVICE_WORKER_SCRIPT, {
                        headers: {
                            'Content-Type': 'application/javascript',
                            'Service-Worker-Allowed': '/'
                        }
                    });
                }

                // 页面请求
                return new Response(isLoggedIn ? HTML_TEMPLATE : LOGIN_TEMPLATE, {
                    headers: { 
                        'Content-Type': 'text/html',
                        'Cache-Control': 'no-store'
                    }
                });
            } catch (error) {
                console.error('请求处理错误:', error);
                return new Response(JSON.stringify({
                    success: false,
                    error: '服务器错误',
                    details: error.message
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // 修改 createItem 函数
        async function createItem(request, item) {
            try {
                // 验证 KV 存储
                if (!request.env?.KV) {
                    throw new Error('KV 存储未配置');
                }

                // 验证必填字段
                if (!item.platform || !item.title || !item.content) {
                    throw new Error('请填写所有必填字段');
                }

                // 验证字段长度
                if (item.title.length < 2 || item.title.length > 50) {
                    throw new Error('标题长度应在 2-50 个字符之间');
                }

                if (item.content.length < 1 || item.content.length > 1000) {
                    throw new Error('内容长度应在 1-1000 个字符之间');
                }

                // 创建新条目
                const id = crypto.randomUUID();
                const newItem = {
                    id,
                    platform: String(item.platform).trim(),
                    title: String(item.title).trim(),
                    content: String(item.content).trim(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                try {
                    // 保存到 KV 存储 - 使用正确的字符串模板语法
                    const key = "item:" + newItem.id;  // 使用字符串拼接
                    await request.env.KV.put(key, JSON.stringify(newItem));
                    console.log('保存成功:', { key, item: newItem });
                } catch (error) {
                    console.error('KV 存储失败:', error);
                    throw new Error('保存失败，请重试');
                }

                return newItem;
            } catch (error) {
                console.error('创建条目失败:', error);
                throw new Error(error.message || '创建失败');
            }
        }

        // 修改 listItems 函数
        async function listItems(request) {
            try {
                if (!request.env?.KV) {
                    throw new Error('KV 存储未配置');
                }

                const items = [];
                let cursor;
                
                do {
                    const listResult = await request.env.KV.list({ 
                        prefix: 'item:',
                        cursor
                    });
                    
                    for (const key of listResult.keys) {
                        try {
                            const value = await request.env.KV.get(key.name);
                            if (value) {
                                items.push(JSON.parse(value));
                            }
                        } catch (e) {
                            console.error('读取条目失败:', e);
                        }
                    }
                    
                    cursor = listResult.cursor;
                } while (cursor);

                // 按创建时间降序排序
                return items.sort((a, b) => 
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
            } catch (error) {
                console.error('获取列表失败:', error);
                throw new Error('获取列表失败');
            }
        }
    </script>
</body>
</html>
`;

// 修改 LOGIN_TEMPLATE 中的样式和结构
const LOGIN_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录 - 密码与密钥管理器</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        body {
            margin: 0;
            padding: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            background-color: #f5f5f5;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .login-container {
            background: rgba(255, 255, 255, 0.95);
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            width: 90%;
            max-width: 400px;
            backdrop-filter: blur(10px);
            text-align: center;
        }

        .login-header {
            margin-bottom: 30px;
        }

        .header-icon {
            width: 64px;
            height: 64px;
            margin-bottom: 15px;
            fill: #4CAF50;
        }

        h1 {
            margin: 0;
            color: #333;
            font-size: 24px;
        }

        .login-form {
            margin-top: 25px;
        }

        .form-group {
            position: relative;
            margin-bottom: 20px;
        }

        .form-group i {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: #666;
            font-size: 18px;
        }

        input[type="password"] {
            width: 100%;
            padding: 12px 15px 12px 45px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s;
            box-sizing: border-box;
        }

        input[type="password"]:focus {
            border-color: #4CAF50;
            box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
            outline: none;
        }

        .login-btn {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.3s;
        }

        .login-btn:hover {
            background: #45a049;
            transform: translateY(-1px);
        }

        .login-btn:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }

        .error-message {
            display: none;
            background: #fff5f5;
            border: 1px solid #ffdce0;
            color: #dc3545;
            padding: 12px;
            border-radius: 6px;
            margin-top: 15px;
            text-align: left;
        }

        .error-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 500;
        }

        .error-details {
            margin-top: 8px;
            font-size: 14px;
            color: #666;
        }

        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }

        .shake {
            animation: shake 0.3s ease;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-header">
            <svg class="header-icon" viewBox="0 0 24 24">
                <path d="M12 1C8.676 1 6 3.676 6 7v3H4v12h16V10h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v3H8V7c0-2.276 1.724-4 4-4z"/>
                <circle cx="12" cy="15" r="2"/>
            </svg>
            <h1>密码与密钥管理器</h1>
        </div>
        
        <form class="login-form" id="loginForm">
            <div class="form-group">
                <i class="fas fa-lock"></i>
                <input type="password" id="password" placeholder="请输入访问密码" required>
            </div>
            <button type="submit" class="login-btn">
                <i class="fas fa-sign-in-alt"></i>
                登录
            </button>
        </form>
        <div id="errorMessage" class="error-message"></div>
    </div>

    <script>
        // 修改背景加载函数
        async function loadLoginBackground() {
            try {
                const response = await fetch('/api/settings', {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'Cache-Control': 'no-cache'
                    }
                }).catch(error => {
                    console.error('请求失败:', error);
                    return null;
                });

                if (!response || !response.ok) {
                    console.warn('使用默认背景设置');
                    document.body.style.backgroundColor = '#f5f5f5';
                    return;
                }

                const data = await response.json().catch(error => {
                    console.error('解析响应失败:', error);
                    return null;
                });

                if (!data || !data.success) {
                    console.warn('使用默认背景设置');
                    document.body.style.backgroundColor = '#f5f5f5';
                    return;
                }

                const settings = data.settings || {};
                if (settings.loginBgImage) {
                    // 预加载图片
                    const img = new Image();
                    img.onload = () => {
                        document.body.style.backgroundImage = \`url('\${settings.loginBgImage}')\`;
                        document.body.style.transition = 'background-image 0.3s ease';
                    };
                    img.onerror = () => {
                        console.warn('背景图片加载失败，使用默认背景色');
                        document.body.style.backgroundColor = settings.theme?.backgroundColor || '#f5f5f5';
                    };
                    img.src = settings.loginBgImage;
                } else {
                    // 使用主题背景色
                    document.body.style.backgroundColor = settings.theme?.backgroundColor || '#f5f5f5';
                }
            } catch (error) {
                console.error('加载背景设置失败:', error);
                // 使用默认背景色
                document.body.style.backgroundColor = '#f5f5f5';
            }
        }

        // 添加重试机制
        async function loadWithRetry(fn, retries = 3, delay = 1000) {
            for (let i = 0; i < retries; i++) {
                try {
                    return await fn();
                } catch (error) {
                    if (i === retries - 1) throw error;
                    console.warn(\`尝试第 \${i + 1} 次失败，\${delay}ms 后重试...\`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // 页面加载时初始化背景
        document.addEventListener('DOMContentLoaded', () => {
            loadWithRetry(loadLoginBackground).catch(error => {
                console.error('加载背景最终失败:', error);
                document.body.style.backgroundColor = '#f5f5f5';
            });
        });

        // 登录表单处理
        document.getElementById('loginForm').onsubmit = async function(e) {
            e.preventDefault();
            const errorEl = document.getElementById('errorMessage');
            const submitBtn = this.querySelector('button[type="submit"]');
            
            try {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 登录中...';
                errorEl.style.display = 'none';
                
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        password: document.getElementById('password').value
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    window.location.reload();
                } else {
                    errorEl.innerHTML = \`
                        <div class="error-title">
                            <i class="fas fa-exclamation-circle"></i>
                            \${data.error || '登录失败'}
                        </div>
                        \${data.details ? \`<div class="error-details">\${data.details}</div>\` : ''}
                    \`;
                    errorEl.style.display = 'block';
                    
                    const input = document.getElementById('password');
                    input.classList.add('shake');
                    setTimeout(() => input.classList.remove('shake'), 500);
                }
            } catch (error) {
                errorEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> 登录失败，请检查网络连接';
                errorEl.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 登录';
            }
        };
    </script>
</body>
</html>
`;

// 修改后端代码
async function handleRequest(request) {
    try {
        const url = new URL(request.url);
        const path = url.pathname;

        // 添加 CORS 预检请求处理
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Max-Age': '86400'
                }
            });
        }

        // 设置接口单独处理，不需要登录验证
        if (path === '/api/settings') {
            return await handleSettings(request);
        }

        // 检查是否已登录
        const sessionToken = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
        const isLoggedIn = await validateSession(request, sessionToken);

        // API 路由处理
        if (path.startsWith('/api/')) {
            // 登录和初始化接口
            if (path === '/api/login' || path === '/api/check-setup') {
                return path === '/api/login' 
                    ? await handleLogin(request)
                    : await handleCheckSetup(request);
            }

            // 其他 API 需要登录
            if (!isLoggedIn) {
                return new Response(JSON.stringify({
                    success: false,
                    error: '未登录或会话已过期'
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 处理各种 API 请求
            switch (path) {
                case '/api/items':
                    if (request.method === 'GET') {
                        const items = await listItems(request);
                        return new Response(JSON.stringify(items), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    } else if (request.method === 'POST') {
                        const item = await request.json();
                        await createItem(request, item);
                        return new Response(JSON.stringify({ success: true }), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    break;
                case '/api/logout':
                    return await handleLogout(request);
                case '/api/change-password':
                    return await handleChangePassword(request);
                default:
                    if (path.startsWith('/api/items/')) {
                        const id = path.split('/').pop();
                        if (request.method === 'DELETE') {
                            await deleteItem(request, id);
                            return new Response(JSON.stringify({ success: true }), {
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                    }
            }
        }

        // Service Worker 请求
        if (path === '/sw.js') {
            return new Response(SERVICE_WORKER_SCRIPT, {
                headers: {
                    'Content-Type': 'application/javascript',
                    'Service-Worker-Allowed': '/'
                }
            });
        }

        // 页面请求
        return new Response(isLoggedIn ? HTML_TEMPLATE : LOGIN_TEMPLATE, {
            headers: { 
                'Content-Type': 'text/html',
                'Cache-Control': 'no-store'
            }
        });
    } catch (error) {
        console.error('请求处理错误:', error);
        return new Response(JSON.stringify({
            success: false,
            error: '服务器错误',
            details: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 处理首次设置检查
async function handleCheckSetup(request) {
    try {
        // 检查是否已有密码
        const hasPassword = await request.env.KV.get('admin:password');
        
        if (!hasPassword) {
            // 首次使用，生成初始密码
            const password = generateRandomPassword();
            const hashedPassword = await hashPassword(password);
            
            // 保存密码和部署信息
            await request.env.KV.put('admin:password', hashedPassword);
            
            const settings = {
                currentPassword: password,
                deployTime: new Date().toISOString()
            };
            await request.env.KV.put('app:settings', JSON.stringify(settings));
            
            return new Response(JSON.stringify({
                isFirstTime: true,
                password: password
            }), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                }
            });
        }
        
        // 已有密码，返回正常状态
        return new Response(JSON.stringify({
            isFirstTime: false
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('设置检查错误:', error);
        return new Response(JSON.stringify({
            success: false,
            error: '设置检查失败'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 修改 handleLogin 函数，添加环境变量登录支持
async function handleLogin(request) {
    try {
        const { password } = await request.json();
        
        // 检查环境变量中是否有自定义密码
        const envPassword = request.env.CUSTOM_PASSWORD;
        if (envPassword && password === envPassword) {
            const sessionToken = crypto.randomUUID();
            await request.env.KV.put(`session:${sessionToken}`, 'valid', { expirationTtl: 86400 });
            
            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
                }
            });
        }

        // 如果没有环境变量密码，则使用 KV 存储的密码
        const storedHash = await request.env.KV.get('admin:password');
        if (await verifyPassword(password, storedHash)) {
            const sessionToken = crypto.randomUUID();
            await request.env.KV.put(`session:${sessionToken}`, 'valid', { expirationTtl: 86400 });
            
            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
                }
            });
        }
        
        // 密码错误时返回更详细的错误信息
        return new Response(JSON.stringify({
            success: false,
            error: '密码错误，请检查后重试',
            details: '如果忘记密码，请联系管理员或查看系统设置'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('登录失败:', error);
        return new Response(JSON.stringify({
            success: false,
            error: '登录失败，请稍后重试',
            details: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 验证会话
async function validateSession(request, sessionToken) {
    if (!sessionToken) return false;
    const isValid = await request.env.KV.get(`session:${sessionToken}`);
    return !!isValid;
}

// 生成随机密码
function generateRandomPassword() {
    const length = 8; // 更短的密码长度
    const numbers = '0123456789';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    
    // 确保密码包含至少一个数字和一个大写字母
    let password = '';
    password += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    password += numbers.charAt(Math.floor(Math.random() * numbers.length));
    
    // 填充剩余字符
    const remainingLength = length - 2;
    const charset = lowercase + numbers;
    for (let i = 0; i < remainingLength; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    
    // 打乱密码字符顺序
    return password.split('').sort(() => Math.random() - 0.5).join('');
}

// 密码哈希（简单实现，实际应使用更安全的方法）
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 验证密码
async function verifyPassword(password, storedHash) {
    const hash = await hashPassword(password);
    return hash === storedHash;
}

// 修改 checkKVBinding 函数
function checkKVBinding(env) {
    console.log('当前环境变量:', env);
    
    if (!env) {
        throw new Error('环境变量未正确传递');
    }
    
    if (!env.KV) {
        throw new Error(`未检测到 KV 绑定，请确保：
1. 已创建 KV 命名空间
2. 在 Workers 设置中绑定变量名为 "KV"
3. 绑定的变量名必须完全匹配 "KV"（区分大小写）`);
    }
}

// 修改 handleRequest 函数
async function processRequest(request) {
    try {
        // 添加详细的环境检查日志
        const envStatus = {
            hasEnv: !!request.env,
            envKeys: request.env ? Object.keys(request.env) : [],
            hasKV: !!request.env?.KV,
            kvType: request.env?.KV ? typeof request.env.KV : 'undefined'
        };
        console.log('环境变量状态:', envStatus);

        // 检查 KV 绑定
        checkKVBinding(request.env);

        const url = new URL(request.url);
        const path = url.pathname;

        if (path.startsWith('/api/')) {
            if (path === '/api/items') {
                if (request.method === 'GET') {
                    const items = await listItems(request);
                    return new Response(JSON.stringify(items), {
                        headers: { 
                            'Content-Type': 'application/json',
                            'Cache-Control': 'no-cache'
                        }
                    });
                } else if (request.method === 'POST') {
                    try {
                        const item = await request.json();
                        await createItem(request, item);
                        return new Response(JSON.stringify({ success: true }), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    } catch (error) {
                        return new Response(JSON.stringify({ 
                            success: false, 
                            error: error.message 
                        }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                }
            } else if (path.startsWith('/api/items/')) {
                const id = path.split('/').pop();
                if (request.method === 'DELETE') {
                    await deleteItem(request, id);  // 修改这里，传入 request
                    return new Response(JSON.stringify({ success: true }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
        }

        return new Response(HTML_TEMPLATE, {
            headers: { 
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache'
            }
        });
    } catch (error) {
        console.error('详细错误信息:', {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name
        });

        return new Response(JSON.stringify({ 
            success: false, 
            error: error.message,
            debug: {
                errorType: error.constructor.name,
                envStatus: {
                    hasEnv: !!request.env,
                    envKeys: request.env ? Object.keys(request.env) : [],
                    hasKV: !!request.env?.KV
                }
            }
        }), {
            status: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    }
}

// 创建新条目
async function createItem(request, item) {
    try {
        if (!request.env?.KV) {
            throw new Error('KV 存储未正确配置');
        }
        
        // 验证必填字段
        if (!item.platform || !item.title || !item.content) {
            throw new Error('缺少必要字段');
        }
        
        const id = crypto.randomUUID();
        const sanitizedItem = {
            id,
            platform: String(item.platform).trim(),
            title: String(item.title).trim(),
            content: String(item.content).trim(),
            createdAt: new Date().toISOString()
        };
        
        await request.env.KV.put(`item:${id}`, JSON.stringify(sanitizedItem));
    } catch (error) {
        console.error('创建项目错误:', error);
        throw new Error('创建失败: ' + error.message);
    }
}

// 列出所有条目
async function listItems(request) {
    try {
        if (!request.env?.KV) {
            throw new Error('KV 存储未正确配置');
        }

        const items = [];
        const keys = await request.env.KV.list({ prefix: 'item:' });
        
        for (const key of keys.keys) {
            try {
                const value = await request.env.KV.get(key.name);
                if (value) {
                    items.push(JSON.parse(value));
                }
            } catch (error) {
                console.error('读取项目错误:', error);
            }
        }
        
        return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
        console.error('列表获取错误:', error);
        throw new Error('无法获取数据列表: ' + error.message);
    }
}

// 修改 deleteItem 函数，添加 request 参数
async function deleteItem(request, id) {
    try {
        if (!request.env?.KV) {
            throw new Error('KV 存储未正确配置');
        }

        if (!id) {
            throw new Error('缺少 ID 参数');
        }
        await request.env.KV.delete(`item:${id}`);
    } catch (error) {
        console.error('删除项目错误:', error);
        throw new Error('删除失败: ' + error.message);
    }
}

// 修改 fetch 函数
export default {
    async fetch(request, env) {
        try {
            if (!env) {
                throw new Error('Workers 环境变量未正确加载');
            }

            // 添加环境变量调试信息
            console.log('Workers 环境:', {
                hasEnv: !!env,
                envKeys: Object.keys(env),
                kvPresent: !!env.KV
            });

            request.env = env;
            return await handleRequest(request);
        } catch (error) {
            console.error('Workers 错误:', {
                message: error.message,
                stack: error.stack,
                type: error.constructor.name
            });

            return new Response(JSON.stringify({
                success: false,
                error: '服务器配置错误，请检查 Workers 设置'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};

// 添加退出处理函数
async function handleLogout(request) {
    try {
        // 获取会话令牌
        const sessionToken = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
        
        if (sessionToken) {
            // 立即删除服务器端会话
            await request.env.KV.delete(`session:${sessionToken}`);
        }

        // 返回清除 Cookie 的响应
        return new Response(JSON.stringify({
            success: true,
            message: '已安全退出'
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
    } catch (error) {
        console.error('退出处理错误:', error);
        return new Response(JSON.stringify({
            success: false,
            error: '退出失败',
            details: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 修改密码更改处理函数
async function handleChangePassword(request) {
    try {
        const { currentPassword, newPassword } = await request.json();
        const storedHash = await request.env.KV.get('admin:password');
        
        // 验证当前密码
        if (!await verifyPassword(currentPassword, storedHash)) {
            return new Response(JSON.stringify({
                success: false,
                error: '当前密码错误'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 更新密码
        const newHash = await hashPassword(newPassword);
        await request.env.KV.put('admin:password', newHash);

        // 更新设置中的密码
        const settingsStr = await request.env.KV.get('app:settings');
        const settings = settingsStr ? JSON.parse(settingsStr) : {};
        settings.currentPassword = newPassword;
        await request.env.KV.put('app:settings', JSON.stringify(settings));

        return new Response(JSON.stringify({
            success: true,
            message: '密码修改成功'
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('密码修改失败:', error);
        return new Response(JSON.stringify({
            success: false,
            error: '密码修改失败'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 添加 Service Worker 脚本
const SERVICE_WORKER_SCRIPT = `
// Service Worker 脚本
const CACHE_NAME = 'password-manager-v1';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll([
                '/',
                '/index.html',
                // 添加其他需要缓存的资源
            ]);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            // 如果在缓存中找到响应，则返回缓存的响应
            if (response) {
                return response;
            }
            // 否则发送网络请求
            return fetch(event.request);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
`;
