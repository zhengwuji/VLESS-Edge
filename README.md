【免责声明 / Disclaimer】

本项目及其所提供的所有代码、数据、说明文档、分析内容 仅供学习、研究与技术探索用途。
请勿将本项目用于以下用途（包括但不限于）：

任何违反当地及国际法律法规的行为

任何危害网络安全、侵犯隐私、入侵系统的活动

任何未获得授权的渗透测试、数据采集、监控行为

任何商业目的、违法盈利或损害他人权益的用途

开发者不对使用者因使用本项目造成的直接、间接损失承担责任。
使用本项目的行为即代表使用者已经理解并同意：

你需对自己的行为 完全负责

你必须 遵守当地所有法律法规

你必须确保所有行为均在 合法授权范围内

若你无法接受上述条款，请立即停止使用本项目。


ECH-Workers 
一、介绍
ECH-Workers 是一个基于 Cloudflare Workers 的 VLESS
节点管理后台，提供无需服务器、可直接部署的节点面板。
本版本为不依赖 KV 的优化稳定版，同时包含完整 GitHub 部署说明。
二、功能特性
1. 无需 VPS，可直接运行
2. 支持 VLESS + WS 节点生成
3. ECH 完整支持
4. 后台密码存储无需 KV
5. 配置全部基于 Cookie / URL 参数
6. 可一键导出订阅、SingBox、v2rayN 等配置

登录密码使用的环境变量：
ADMIN_PASSWORD 环境变量（可在 Cloudflare Dashboard 配置）。登陆密码
SESSION_SECRET 环境变量，用于签名 Cookie  订阅连接验证

Disclaimer

This project and all associated source code, data, and documentation are intended solely for educational and research purposes.

You must NOT use this project for:

Any activity that violates local or international laws

Any unauthorized security testing, intrusion, or privacy invasion

Any harmful, malicious, or unethical behavior

Any commercial or profit-driven misuse

By using this project, you acknowledge and agree that:

You are fully responsible for your own actions

You must comply with all applicable laws and regulations

The authors and contributors assume no liability for any misuse

If you do not agree with these terms, do not use this project.
