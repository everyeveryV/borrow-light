# BorrowLight 合约

当前前端配置的 `address` 为 `null`，尚未部署到 Monad 测试网。以下脚本不会因为编译或测试而发送公网交易。

```sh
npm run compile
npm run test:contracts
```

编译使用本地 `solc 0.8.28`、Cancun、优化器和 viaIR，不下载远程编译器。测试使用 Hardhat 进程内网络，逐条读取 `shared/vectors.json`，分别验证成功帧数、拾取结果、落水帧数与机关序号，并对可通关向量真实调用 `submitRun`。`contracts/gas-report.json` 记录的是本地 Ethereum Cancun 计费下的执行消耗，不能当作 Monad 的链上实测。

## 部署准备

将根目录 `.env.example` 复制为本地 `.env`，填入仅用于测试网的 `DEPLOYER_PRIVATE_KEY`，并准备少量测试 MON。不要提交 `.env`。然后运行：

```sh
npm run deploy:contract
node contracts/scripts/verify.mjs
```

部署脚本核验 RPC 的 chain ID 必须为 `10143`；每次交易先预执行并估算 gas，只加 10% 余量。它部署合约、从唯一数据源初始化五关、写入三条种子灯谱，逐步更新 `app/src/chain/deployment.json`。中断后重跑会沿用已有地址、跳过已初始化的关卡和已存在的种子。依赖上一笔交易的操作会等额外三个区块。

`verify.mjs` 将公开的标准编译输入和元数据发到 Monad 统一源码验证接口。构建输出也包含 `borrowLightBytecode`，可供后续钱包部署界面使用。

## 规则与约束

- 一关只能初始化一次，避免修改规则后让历史成绩或借光失效。
- 全部坐标与帧数均为整数；移动、拾取、危险检测、自动抵达的顺序与前端一致。
- `previewRun` 是只读重放；`submitRun` 重放通过才写入成绩与灯谱。
- 灯谱长度、灯编号、切换次数、输入长度、全部输入字节均校验。通关后的尾部也不能包含非法字节。
- 排行榜每关最多十个不同地址，同分保留先提交的顺序；重复提交不会占多个名次。
- 可以提交相同的有效输入，也可以借自己的光。合约证明规则有效性，不证明输入由人类实时操作；借光次数统计成功借用交易次数，不统计独立用户。
- 个人最佳按玩家地址分开存储；灯谱池、全局灯谱计数器和排行榜仍是共享写入点，适用于黑客松规模。

## 可选灯童接口

`authorizeAndFund(burner)` 转账并提出授权，但不会直接改写该钱包的成绩归属。灯童必须从自己的地址签署 `acceptOperator(player)` 才生效；这一步可以由临时钱包自动完成。这个双向确认防止任何人指定他人地址为灯童、冒领他人的成绩。主钱包随后可用 `revoke(burner)` 撤销。当前 P0 前端没有启用灯童。

`lendLight` 允许在第 4 关只上传合法灯谱，`thank` 可把测试 MON 直接转给灯谱作者；两项均不影响核心通关验证。
