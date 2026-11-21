# Monad 测试网部署记录

- 网络：Monad Testnet，chain ID `10143`。
- 时间：2026-11-21 14:44:56（UTC+8）。
- 合约：`0xfc1d55e57774bec10dd4dd4a13798d66e98be7a1`。
- 部署交易：`0xb798fb7d8728d901743aef734da97ed7e183533511f788aa5bd8062028317303`。
- 部署区块：`81510552`。
- 关卡：1–5 初始化完成。
- 借光种子：S1、S2、S3 对应 score ID 1、2、3。
- 部署与初始化共消耗约 0.423 测试 MON。

[MonadVision 合约与源码](https://testnet.monadvision.com/address/0xfc1d55e57774bec10dd4dd4a13798d66e98be7a1)

[Monadscan 合约与源码](https://testnet.monadscan.com/address/0xfc1d55e57774bec10dd4dd4a13798d66e98be7a1)

[部署交易](https://testnet.monadvision.com/tx/0xb798fb7d8728d901743aef734da97ed7e183533511f788aa5bd8062028317303)

源码验证接口返回 2 / 2 成功，MonadVision 为 perfect match，Monadscan 为 verified。

部署后读链验证：runtime bytecode 与本地编译结果完全一致；owner 正确；五关配置与本地规则一致；三份种子内容一致。七份参考解的 `submitRun` 模拟全部成功。

尚未进行浏览器钱包签名、真实通关提交及两个玩家互借验收。只读模拟不产生交易，不代表玩家已有链上通关成绩。

前端配置已写入 `app/src/chain/deployment.json`。私钥只保留在本机忽略文件 `.env`，不写入前端配置。
