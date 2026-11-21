# 借个光 · Monad 版 产品需求文档（PRD）

> 读者：负责实现的 Codex。
> 活动：Monad Blitz@广州 一日黑客松，**提交截止 2026-11-21 18:30（UTC+8）**。
> 基础：`borrow-light/index.html` 单文件试玩版（下文称「原型」）。新版本在原型的美术、文案气质和核心手感上扩展，不推翻重来。

---

## 0. 一句话

**借个光**：你在骑楼上为过河的人掌灯，灯谱写上 Monad 链。合约逐帧重放你的灯光和脚步来验证通关；通关后你的这束光会留在链上，陌生人可以借去照亮他们的路。

核心卖点（给评委的三句话）：

1. **链上可验证通关**：游戏逻辑是确定性的定步长模拟，合约用同一套规则重放输入，作弊提交的成绩会被拒绝。Monad 的 gas 便宜、单笔交易 gas 上限高（30M），所以整局模拟可以放在链上跑。
2. **借光 = 异步多人**：每条通关灯谱都是链上的公共资源。第 4 关灯油不够，必须借一束别人的光才能过；被借的人会得到「借光次数」，这个数会显示在排行榜上。
3. **秒级上链反馈**：摇响风铃后立即提交交易，界面显示「已上链 · 0.8 秒 · 区块 #xxxx」。Monad 出块约 0.4 秒、约 0.8 秒最终确认，这个反馈会让人明显感到快。第 5 关每拍 0.4 秒，正好等于一个 Monad 区块。

---

## 1. 原型现状与问题（改版依据）

原型玩法：先在楼上用 1/2 键录 8 秒灯谱（16 格，每格 0.5 秒，每格照桥一或桥二），然后到楼下沿灯光过河，站在没亮的桥上会落水，8 秒内走到右岸摇响风铃即通关。落水后可以回放，也可以直接点格子修改灯谱。另有可选的纸船收集。

需要改的问题：

| 问题 | 改法 |
|---|---|
| 灯谱可以随意点改，录制环节基本没意义；示例灯谱一路按住 → 就能通关，缺少挑战 | 引入「灯油」（每关限制切换次数）、潮汐石台、必取道具、双灯借光等约束，难度递进 |
| 只有 1 关 | 扩到 5 关，带关卡选择和星级 |
| 逻辑按可变 `dt` 推进，结果不确定，无法复现或上链验证 | 改为 **20Hz 定步长、整数坐标** 的纯函数模拟，前端和合约规则逐字一致 |
| 需要手动按空格摇铃，计时边界含糊 | 走进风铃区（并持有必需道具）时**自动摇铃**，完成帧就是成绩 |
| 阳台上的「过去的自己」只是装饰 | 第 4 关显示被借灯谱的作者（短地址），成为「借光的人」 |
| 343KB 单文件，背景图以 base64 内联 | 拆成工程化目录，图片提取为静态资源 |
| 只能本地存储 | 链上记录成绩、灯谱池和排行榜；未连钱包时仍可完整离线游玩 |

保留：画面风格（雨后骑楼、纸桥、光束、雨丝、风铃）、诗意中文文案、录光 → 过桥 → 复盘的循环、回看落水、触屏按钮、Esc 暂停、失焦自动暂停、声音开关。

---

## 2. 范围与优先级（按时间切线）

当前约 13:20，离截止约 5 小时。**严格按优先级做，P0 全部可演示之后才做 P1。**

- **P0（16:00 前必须完成）**
  - 确定性模拟内核 `sim`（JS/TS），5 关数据，关卡选择页，离线可玩全部 5 关（第 4 关离线时使用内置种子灯谱）
  - 合约 `BorrowLight.sol`：关卡配置、`submitRun` 链上重放验证、灯谱池、个人最佳、排行榜
  - 共享测试向量（JS 和合约用同一份），部署到 Monad 测试网
  - 前端连接注入钱包（MetaMask 等），通关后上链，显示交易哈希、区块号和确认耗时
  - 第 4 关从链上灯谱池借光
- **P1（17:00 前，能做多少做多少）**
  - 免签「灯童」临时钱包（burner + 主钱包授权），通关不再弹窗
  - 实时动态条：轮询 `RunCleared` / `LightLent` 事件，显示「0x12…ab 刚借了 0x9f…3c 的光」
  - 被借灯谱作者在阳台上显示为第二个幽灵，带短地址标签
  - 第 4 关「只掌灯不行路」：直接发布一束光到灯谱池（`lendLight`）
- **P2（有余力再做）**
  - `thank(scoreId)`：给借来那束光的作者打赏少量 MON
  - 头部显示 Monad 实时区块号，灯笼随新区块闪一下
  - 灯童余额一键取回
  - 合约在浏览器上验证源码
- **16:30 起（剩 2 小时）：停止开发新功能**，只修 bug、打磨、写 README、截图、部署前端
- **18:00：冻结并提交到 MOJO**

明确不做：代币/NFT 发行、后端服务器、索引器（Envio 等）、EIP-7702 委托、账号体系。

---

## 3. 玩法规则（新版）

### 3.1 基本循环

1. **选关**：关卡地图上有 5 盏灯笼，依次解锁，显示星级。
2. **（仅第 4 关）借光**：从灯谱池选一束别人的光，它会作为只读的第二条灯轨显示。
3. **掌灯**：实时录制灯谱，或在灯谱格子上直接编辑。每格的值是「这一拍灯照向哪座桥」，取值 `1..lampCount`。
4. **过桥**：按住 → / D 向右，← / A 向左，E 拾取道具，可以停下等待。落水后进入复盘。
5. **抵达**：走进风铃区自动摇铃，结算星级。已连钱包时自动发起上链（或点「上链」）。
6. **复盘**：显示落水的拍和原因（哪座桥没亮 / 潮水上涨），可以回看、改谱、再走。

### 3.2 机关

| 机关 | 规则 | 首次出现 |
|---|---|---|
| 纸桥（lamp gap） | 只有这一拍被你的灯或借来的灯照着时才能站上去 | 第 1 关 |
| 石台（安全区） | 不属于任何 gap 的地面，永远安全，可以在上面等 | 第 1 关 |
| 灯油（maxSwitches） | 灯谱相邻两拍取值不同就算 1 次切换，总次数不能超过上限。超过上限时，录制中的切换会被忽略并提示「灯油耗尽」，编辑时禁用「开始过桥」 | 第 2 关 |
| 潮汐石台（tide gap） | 有固定的涨退潮表（按拍），涨潮的拍站在上面就落水 | 第 3 关 |
| 道具（纸船 / 灯笼） | 在道具附近按 E，原地拾取若干帧，期间不能移动。可以是可选收集，也可以是通关必需 | 第 3 关可选，第 5 关必需 |
| 借光（第二盏灯） | 借来的灯谱和你的灯谱取并集，任何一盏照着的桥都可以走 | 第 4 关 |

### 3.3 星级

- ★ 通关
- ★★ 完成帧 ≤ `par2`
- ★★★ 完成帧 ≤ `par3`

收集到可选道具时显示「拾舟」徽章，不计入星级。排行榜按 `finishTick` 升序排名，平局时先提交的排在前面。

---

## 4. 确定性模拟规范（前端和合约必须逐字一致）

这是整个项目的地基。**先写 `sim.ts` 和测试向量，再写渲染和合约。**

### 4.1 单位

- 坐标沿用原型的 1120 宽画布坐标，模拟内部使用 **deci-px（0.1 像素）整数**，下文表格里的数值单位是 px，实际要乘以 10。
- 定步长 `TICK = 50ms`（20Hz）。移动速度 144 px/s，即 **每帧 72 deci-px**。
- `beatTicks`：每拍帧数。0.5 秒一拍为 10，0.4 秒一拍为 8。
- 总帧数 `T = beats * beatTicks`。

### 4.2 输入编码

- `score`：`bytes`，长度等于 `beats`，每字节取值 `1..lampCount`。
- `borrowed`：同格式，或为空（不借光）。
- `inputs`：`bytes`，每字节表示一帧的动作：`0` 不动，`1` 右移，`2` 左移，`3` 交互（拾取道具）。长度 ≤ `T`，超出部分视为 `0`。
- 前端采样方式：每帧开始时读取按键状态。如果上一帧间隔内按下过 E，本帧记为 `3`（优先级最高）；否则按住右键记 `1`，按住左键记 `2`，都没按记 `0`。通关后把 `inputs` 截断到完成帧。

### 4.3 每帧更新（伪代码，JS 和 Solidity 都照此实现）

```
x = startX; hasItem = false; busy = 0
for tick in 0 .. T-1:
    beat = tick / beatTicks            // 整数除法
    a = tick < inputs.length ? inputs[tick] : 0
    if busy > 0:
        busy -= 1
        if busy == 0: hasItem = true
    else if a == 1: x = min(maxX, x + speed)
    else if a == 2: x = max(minX, x - speed)
    else if a == 3 and level.hasItem and !hasItem and abs(x - itemX) <= itemRadius:
        busy = itemTicks
    // 危险判定（移动之后，每帧都判，包括拾取期间）
    for g in gaps:
        if g.a < x < g.b:              // 严格不等，边界点安全
            if g.kind == LAMP: ok = score[beat] == g.lamp or (borrowed.len > 0 and borrowed[beat] == g.lamp)
            else /* TIDE */:   ok = (g.mask >> beat) & 1 == 1   // 1 = 退潮可走
            if !ok: return FELL(tick, gapIndex)
    // 抵达判定
    if x >= bellX and (!level.itemRequired or hasItem):
        return WIN(finishTick = tick + 1, hasItem)
return TIMEUP
```

另有一个独立函数 `switches(score) = 相邻两拍取值不同的次数`，要求结果 ≤ `maxSwitches`；借来的灯谱同样要满足这个上限。

### 4.4 前端要求

- 游戏逻辑只通过 `sim.step()` 按 20Hz 推进；渲染层用 `requestAnimationFrame`，在两帧之间对位置插值，保证手感顺滑。
- 落水、回看、复盘都基于记录下来的 `inputs` 重放，不再用原型的 `attempt` 轨迹采样。
- `sim` 是纯函数模块，不依赖 DOM，Node 下可直接测试。

### 4.5 测试向量（P0）

建立 `shared/vectors.json`，每关至少包含：1 条参考通关解，1 条落水用例（期望 `fellTick` 和 `gapIndex`），1 条超时用例。第 3 和第 5 关加 1 条潮水落水用例，第 4 关每条种子灯谱配 1 条通关解。**JS 测试和合约测试读取同一份文件**，结果必须完全一致。参考解可以手写，也可以写一个简单搜索器生成。

---

## 5. 关卡设计（数值已手算校验可解，最终以参考解实测为准微调）

通用参数：`minX = 72`，`maxX = 1045`，速度 144 px/s。风铃画在 `bellX + 26` 处。

### 第 1 关 · 雨后骑楼（教学）
- 文案：「为八秒后的自己，照一段路。」
- `startX 125`，`bellX 964`，`beatTicks 10`，`beats 16`（8 秒），`maxSwitches 15`（相当于不限）
- gaps：桥一 `[241, 426]`，桥二 `[640, 842]`
- 可选道具：纸船 `itemX 531`，`itemTicks 28`（1.4 秒），`itemRadius 40`
- 参考解：桥一照前 7 拍，之后照桥二，全程按住右键，约 5.85 秒抵达
- par：★★ ≤ 130 帧，★★★ ≤ 118 帧

### 第 2 关 · 三拱桥（灯油）
- 文案：「灯油只够换两次。」
- `startX 100`，`bellX 974`，`beats 14`（7 秒），`maxSwitches 2`
- gaps：桥一 `[200, 330]`，桥二 `[450, 600]`，桥三 `[720, 880]`
- 参考解：第 0–3 拍照桥一，第 4–7 拍照桥二，第 8 拍起照桥三，一路直走约 6.07 秒
- par：★★ ≤ 130，★★★ ≤ 122

### 第 3 关 · 潮汐渡口（等待）
- 文案：「潮水退去之前，先在石台上等一等。」
- `startX 100`，`bellX 974`，`beats 22`（11 秒），`maxSwitches 1`
- gaps：桥一 `[200, 340]`（灯），潮汐石台 `[460, 620]`（tide，第 6–10 拍涨潮，其余拍可走），桥二 `[740, 880]`（灯）
- 可选道具：纸船 `itemX 680`，`itemTicks 28`
- 解法要点：直走会在 3.0 秒涨潮时被困在潮汐石台上，必须先在 `[340, 460]` 石台上等到 5.5 秒退潮。不拿纸船约 9.1 秒抵达；拿纸船约 10.5 秒，余量很小
- par：★★ ≤ 200，★★★ ≤ 186

### 第 4 关 · 借光（双灯）
- 文案：「灯油不够，向陌生人借一盏。」
- `startX 80`，`bellX 1010`，`beats 20`（10 秒），`maxSwitches 2`，`borrowable = true`
- gaps：五座窄桥 `[150,250] [330,430] [510,610] [690,790] [870,960]`
- 单灯走完 5 座桥需要切换 4 次，超出灯油上限，所以必须借光。
- 部署脚本写入 3 条种子灯谱（作者为部署者，前端标为「陌生人」），每条都必须有对应的己方解并写进测试向量：
  - S1：第 0–4 拍照桥 2，第 5–19 拍照桥 4。己方解：桥 1（0–2 拍）→ 桥 3（3–9 拍）→ 桥 5（10–19 拍）
  - S2：桥 1（0–2 拍）→ 桥 3（3–9 拍）→ 桥 5（10–19 拍）。己方解：桥 2（0–6 拍）→ 桥 4（7–19 拍）
  - S3：桥 1（0–3 拍）→ 桥 4（4–19 拍）。己方解：桥 2（0–4 拍）→ 桥 3（5–9 拍）→ 桥 5（10–19 拍）
- 通关后你的灯谱进入本关灯谱池，后来的玩家可以借你的光（这就是「光的接力」）
- par：★★ ≤ 140，★★★ ≤ 131

### 第 5 关 · 夜市长街（Monad 节拍）
- 文案：「这里每一拍，都是 Monad 的一个区块（0.4 秒）。」
- `startX 80`，`bellX 1010`，`beatTicks 8`，`beats 25`（10 秒），`maxSwitches 3`
- gaps：桥一 `[150,260]`，桥二 `[340,450]`，潮汐石台 `[530,640]`（`beat % 6 < 3` 时可走），桥三 `[720,830]`，桥四 `[910,980]`
- **必需道具**：灯笼 `itemX 680`，`itemTicks 16`（0.8 秒）。没有灯笼时风铃门不开，走进风铃区也不算抵达
- 解法要点：在潮汐石台前等到 4.8 秒退潮 → 过潮汐石台 → 拾灯笼 → 桥三 → 桥四。灯谱：桥一（0–3 拍）→ 桥二（4–?）→ 桥三（…–19 拍）→ 桥四（20 拍起），约 8.95 秒抵达
- par：★★ ≤ 188，★★★ ≤ 180

> 如果参考解实测和上面的估算有出入，**只调整 par、`beats` 和 gap 端点**，不要改机关规则，并同步更新 `levels.json` 和测试向量。

关卡数据放在唯一的数据源 `shared/levels.json`，前端直接导入，部署脚本读它写进合约。

---

## 6. 智能合约 `BorrowLight.sol`

### 6.1 存储

```
LevelConfig { beatTicks, beats(≤32), startX, bellX, minX, maxX, speed,
              maxSwitches, lampCount, borrowable, hasItem, itemRequired,
              itemX, itemRadius, itemTicks, par2, par3, uint256[] gaps }
// gap 打包成一个 uint256: a(16) | b(16) | kind(8) | lamp(8) | mask(32)

LightScore { address author; uint8 level; uint16 finishTick; uint32 borrowCount; bytes32 score }
// score ≤ 32 字节，用 bytes32 存进一个槽，并记录 beats 长度

mapping(uint256 => LightScore) scores;           // id 从 1 开始，0 表示不借
mapping(uint8 => uint256[]) pool;                 // 每关可借的灯谱 id（只追加）
mapping(address => mapping(uint8 => Best)) best;  // Best { uint16 tick; uint8 stars; uint32 scoreId }
mapping(uint8 => bytes32[10]) board;              // 每项打包 address(160)|tick(16)|stars(8)
mapping(address => uint32) lightGiven;            // 我的光被借过多少次
mapping(address => address) operatorOf;           // P1：灯童 → 主钱包
```

### 6.2 接口

```solidity
function setLevel(uint8 id, LevelConfig calldata cfg) external onlyOwner;
function submitRun(uint8 level, bytes calldata score, bytes calldata inputs, uint256 borrowedId)
    external returns (uint256 scoreId);
function lendLight(uint8 level, bytes calldata score) external returns (uint256 scoreId); // 仅 borrowable 关卡
function getLevel(uint8 id) external view returns (LevelConfig memory);
function getScore(uint256 id) external view returns (LightScore memory);
function getPool(uint8 level, uint256 offset, uint256 limit) external view returns (uint256[] memory ids, LightScore[] memory items);
function getBest(address player) external view returns (Best[5] memory);
function getBoard(uint8 level) external view returns (address[] memory, uint16[] memory, uint8[] memory);
// P1
function authorizeAndFund(address burner) external payable; // 一笔交易同时完成授权和转账（转给 burner）
function revoke(address burner) external;
// P2
function thank(uint256 scoreId) external payable;           // 转给作者
```

`submitRun` 流程：
1. `player = operatorOf[msg.sender] != 0 ? operatorOf[msg.sender] : msg.sender`
2. 校验 `score` 的长度、取值和切换次数；`borrowedId` 非 0 时，校验关卡可借、灯谱属于同一关
3. 按第 4 节规则重放。失败时用自定义错误 revert：`Fell(uint16 tick, uint8 gap)`、`TimeUp()`、`BadScore()`、`BadBorrow()`
4. 成功：写入新的 `LightScore`；可借关卡把它加入 `pool`；`borrowedId` 非 0 时作者的 `borrowCount++`、`lightGiven++`；成绩更好时更新 `best`；能进前 10 时插入 `board`
5. 发出事件 `RunCleared(player, level, scoreId, finishTick, stars, borrowedId, hasItem)`；`lendLight` 发出 `LightLent(author, level, scoreId)`

### 6.3 Monad 相关注意事项

- **gas 按 gas limit 收费，不按实际用量**：前端用 `estimateGas × 1.1` 作为 gasLimit，禁止设一个很大的固定值。目标是单次 `submitRun` ≤ 400k gas，在测试里打印实测值。
- **冷存储访问更贵**（SLOAD 冷读 8100）：排行榜每项打包进一个槽，模拟时把关卡配置一次性读进 memory 再循环。
- **并行执行**：每个玩家的成绩放在按地址索引的 mapping 里，互不冲突；只有 `pool` 和 `board` 是共享热点，黑客松规模可以接受，在 README 里说明这个取舍。
- 编译器 `0.8.24+`，`evmVersion: cancun`。

### 6.4 工具链

本机已有 Node 20、npm、git，**没有 Foundry**。推荐 **Hardhat + viem**（Windows 原生可用）。如果坚持用 Foundry，需要自行安装，并评估在 Windows 上耗费的时间。

- 网络：Monad 测试网，`chainId 10143`，RPC `https://testnet-rpc.monad.xyz`
- 区块浏览器：`https://testnet.monadvision.com`（备选 `https://testnet.monadscan.com`）
- 测试币：`https://faucet.monad.xyz`
- 部署私钥放在 `.env`（加入 `.gitignore`）
- 部署脚本：部署合约 → 读取 `levels.json` 逐关 `setLevel` → 第 4 关写入 S1–S3 → 把地址写进 `app/src/chain/deployment.json`

---

## 7. 前端

### 7.1 技术栈与目录（建议）

Vite + TypeScript（原生，不用框架）+ viem。Canvas 渲染沿用原型代码并拆分模块。

```
borrow-light/
  prototype.html            # 原型原样保留（从 index.html 改名）
  PRD.md
  shared/levels.json  shared/vectors.json
  app/                      # Vite 前端
    src/game/sim.ts         # 纯函数确定性内核
    src/game/render.ts      # 场景、桥、光束、潮水、道具、幽灵、雨
    src/game/audio.ts
    src/ui/levelSelect.ts  src/ui/console.ts  src/ui/timeline.ts  src/ui/borrowPanel.ts  src/ui/result.ts  src/ui/board.ts
    src/chain/client.ts  src/chain/abi.ts  src/chain/burner.ts  src/chain/deployment.json
    public/assets/plate.webp   # 从原型 base64 提取
  contracts/                # Hardhat
    contracts/BorrowLight.sol  scripts/deploy.ts  test/BorrowLight.test.ts
```

### 7.2 页面与状态

1. **关卡地图**：雨夜长街上 5 盏灯笼，显示锁定/解锁状态和星级。右上角是钱包状态（未连接 / 地址 / 灯童已就位）。底部是实时动态条（P1）。离线时用 localStorage 判断解锁；连钱包后合并链上 `getBest` 的结果。
2. **关卡内**：沿用原型布局（场景 + 控制台 + 灯谱时间轴），新增：
   - HUD：灯油剩余（例如「灯油 1/2」）、拍长、本关 par
   - 时间轴支持**多条轨道**：我的灯谱（可编辑）、借来的灯谱（只读，标注作者短地址）、潮汐表（只读，涨潮格显示深蓝色）
   - 格子数按 `beats` 动态生成。编辑：点击在 `1..lampCount` 之间循环；也可以先选中格子再按数字键
   - 录制：数字键 `1..N` 或直接点桥切换
   - 道具和潮汐石台的可视化：潮汐用水位升降和石台被淹表现，在涨潮前 1 拍给出预警
3. **借光面板（第 4 关进入时）**：列出灯谱池（作者短地址、被借次数、迷你时间轴），可以「随机借一盏」，也可以选「借上次自己的光」。未连钱包或链上读取失败时，回退到内置的 S1–S3。
4. **结算**：星级、用时（秒和帧）、是否拾舟。上链状态依次为「签名中 → 已广播 → 已上链 · X.X 秒 · 区块 #N」，附浏览器链接。可借关卡额外提示「你的光已留在第 4 关，等人来借」。
5. **排行榜**（弹窗，每关前 10）：地址、用时、星级、该地址的「借出光」次数。

### 7.3 链上交互

- 进入页面时只读 RPC，不强制连钱包；连钱包后检查链 ID，不是 10143 时调用 `wallet_switchEthereumChain` / `wallet_addEthereumChain`。
- 提交前先在本地用 `sim` 判定，只提交确认通关的局；再用 `simulateContract` 预检，失败就展示合约返回的错误，不弹钱包窗口。
- 确认耗时从拿到交易哈希开始计时，到 `waitForTransactionReceipt` 返回为止。读取用 `latest`。
- 链上失败不影响游戏：本地成绩照常保存，并提供「稍后上链」按钮（保存最近一次通关的 `score`、`inputs`、`borrowedId`）。

### 7.4 灯童临时钱包（P1）

目的：游戏过程中零弹窗。

1. 用户点「开启免签」→ 在 localStorage 生成一把 burner 私钥。
2. 主钱包调用一次 `authorizeAndFund(burner)`，附带 0.2 MON：合约记录 `operatorOf[burner] = 主钱包`，并把 MON 转给 burner。这是唯一一次弹窗。
3. **Monad 异步执行**：新到账的账户要等约 3 个区块（约 1.2 秒）才能发交易。界面显示「灯童就位中…」，确认余额后再等 3 个区块，然后变成「灯童已就位」。
4. **储备余额规则**：余额低于 10 MON 的账户每 3 个区块（约 1.2 秒）只能发 1 笔交易。所有 burner 交易必须进入串行队列，两笔之间至少间隔 1.5 秒。
5. 之后的 `submitRun` 由 burner 签名，链上成绩仍记在主钱包名下。
6. 在界面注明「临时钱包私钥只保存在本浏览器，请勿存入大额」。

---

## 8. 视觉与文案

- 保持原型的雨夜骑楼质感、暖黄色光束和青蓝色调。每关在同一张背景图上做色调或滤镜变化（第 3 关更湿、水位更高，第 5 关有夜市灯笼串），不要求新画大图。
- 风铃区加一扇门：第 5 关没有灯笼时门是关着的。
- 第 4 关：右侧阳台上出现第二个幽灵，头顶显示被借灯谱作者的短地址，光束用另一种冷色。
- 第 5 关：光束随拍闪烁，副标题显示「0.4 秒 = 1 个 Monad 区块」。
- 文案继续用简短、温柔的中文短句，例如落水时「这一拍，你和灯错开了」，上链时「风铃声已写进第 #N 个区块」。

---

## 9. 验收标准

**P0（全部满足才算可演示）**
- [ ] 不连钱包时，5 关都能从头玩到通关；第 4 关可以使用内置种子灯谱
- [ ] `vectors.json` 中所有用例在 JS 测试和 Hardhat 测试里结果一致（通关帧、落水帧、gap 序号）
- [ ] 灯油超限时无法开始过桥，并有明确提示；潮汐落水有专门的提示文案
- [ ] 合约已部署到 Monad 测试网，关卡配置和 S1–S3 已写入，地址写在 README 和 `deployment.json` 里
- [ ] 连钱包后通关可以上链，结算页显示交易链接、区块号和确认耗时；关卡地图上的星级来自链上
- [ ] 第 4 关可以从链上灯谱池借光，通关后被借灯谱的 `borrowCount` 增加
- [ ] 篡改 `inputs` 或 `score` 后直接调用合约会 revert（测试覆盖）
- [ ] `submitRun` 实测 gas 记录在 README 中，前端 gasLimit 来自估算值

**P1**
- [ ] 开启灯童后连续通关两关，没有出现钱包弹窗，排行榜显示主钱包地址
- [ ] 动态条能在约 2 秒内显示另一个浏览器的通关事件

---

## 10. 演示脚本（3 分钟）

1. （20 秒）第 1 关：录光、过桥、摇铃，结算页显示「已上链 · 0.8 秒」，点开浏览器链接。
2. （40 秒）第 3 关：先直走被潮水淹没，回看落水的那一拍，改成在石台上等待后通关。
3. （60 秒）第 4 关：灯油不够，打开借光面板，借一条「陌生人」的光，时间轴出现两条轨道，通关。再换一个浏览器借刚才那束光，排行榜上「借出光」次数 +1，动态条实时出现记录。
4. （30 秒）第 5 关：0.4 秒节拍，必须先拿灯笼，结尾强调「每一拍就是一个 Monad 区块」。
5. （30 秒）讲链上可验证：展示合约 `Fell` revert 的测试截图，说明 gas 便宜、单笔交易 gas 上限高是整局重放能放在链上的前提。

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| JS 和 Solidity 模拟结果不一致 | 共用一份测试向量；所有计算用整数，不用浮点；严格按第 4.3 节的顺序实现 |
| 公共 RPC 限流或抖动 | 离线模式完整可玩；事件轮询间隔 ≥ 1 秒；读取失败时降级到内置数据 |
| 测试币不足 | 每笔交易 gas 都很小；提前从水龙头领取；灯童只充值 0.2 MON |
| 时间不够 | 严格按 P0 → P1 → P2 推进；16:30 后不开新功能；18:00 无论做到哪一步都先提交 |
| 有人用脚本算出最优输入刷榜 | 可以接受：这是解谜游戏，链上只保证成绩真实有效；在 README 里说明 |

---

## 12. 交付物

- 可运行的前端（本地 `npm run dev`，并部署一个公开链接，比如 Vercel 或 GitHub Pages）
- 已部署的测试网合约地址和浏览器链接
- README：玩法、Monad 特性如何使用、合约地址、gas 实测、本地运行步骤、演示截图
- 3–5 张截图（关卡地图、第 3 关潮汐、第 4 关双轨借光、结算上链、排行榜），用于 MOJO 提交
