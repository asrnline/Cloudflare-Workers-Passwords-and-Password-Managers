# Passwords and Password Managers

## Features

- 🌐 Zero-dependency Deployment - Runs entirely on Cloudflare Workers
- 📧 End-to-end Encryption - All password data encrypted client-side before storage
- 💻 Fast Response - Leverages Cloudflare's global edge network
- ☁️ Secure Storage - Uses KV storage for encrypted password data
- 💳 Cross-platform Support - Works with all modern browsers


## Usage

### Password Management System - Cloudflare Worker

#  Make sure KV and environment variables are available

# Instructions:

#  1. Create a KV namespace in Cloudflare Dashboard named "MEMOS"

#  2. Bind this KV namespace to the variable MEMOS_KV in the Worker configuration

#  3. Add environment variables:

#  - ACCESS_UUID: Access key

# - ACCESS_PASSWORD: Management password (optional)

# - ACCESS_MULTIFACTOR: Multiple verification code (optional, enable multiple verification after setting)

*

# KV namespace, please bind in Cloudflare Dashboard

# MEMOS_KV variable has been bound to the KV namespace named "MEMOS" through Dashboard

# No need to bind manually here

# Environment variables, set in Cloudflare Dashboard

# const ACCESS_UUID = ACCESS_UUID;

# const ACCESS_PASSWORD = ACCESS_PASSWORD;
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
