# Passwords and Password Managers

## Features

- 🌐 Zero-dependency Deployment - Runs entirely on Cloudflare Workers
- 📧 End-to-end Encryption - All password data encrypted client-side before storage
- 💻 Fast Response - Leverages Cloudflare's global edge network
- ☁️ Secure Storage - Uses KV storage for encrypted password data
- 💳 Cross-platform Support - Works with all modern browsers

## Getting Started

### Prerequisites

- Cloudflare Account

### Installation

```bash
Copy code to Cloudflare Workers
```

## Configuration

1. Create KV namespace in Cloudflare Dashboard

```toml
Create KV namespace

Name: KV 

Variable:KV
```

## Usage

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

```

## Security Notes

- All passwords are client-side encrypted before being sent to server
- Convenient password management
- Master key is never transmitted to the server

## Contributing Guidelines

Pull Requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.

Disclaimer: Not for commercial use. Secondary development agreed, currently 80% complete.

## License

MIT - See [LICENSE](LICENSE) file for details

## Author

Asrn Line - [GitHub](https://github.com/asrnline)
