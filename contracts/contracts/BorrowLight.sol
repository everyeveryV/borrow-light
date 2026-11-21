// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Deterministic 20 Hz puzzle replay. Positions are integer deci-pixels.
contract BorrowLight is Ownable, ReentrancyGuard {
    struct LevelConfig {
        uint8 beatTicks;
        uint8 beats;
        uint16 startX;
        uint16 bellX;
        uint16 minX;
        uint16 maxX;
        uint16 speed;
        uint8 maxSwitches;
        uint8 lampCount;
        bool borrowable;
        bool hasItem;
        bool itemRequired;
        uint16 itemX;
        uint16 itemRadius;
        uint16 itemTicks;
        uint16 par2;
        uint16 par3;
        uint256[] gaps;
    }

    struct LightScore {
        address author;
        uint8 level;
        uint16 finishTick;
        uint32 borrowCount;
        bytes32 score;
    }

    struct Best { uint16 tick; uint8 stars; uint32 scoreId; }
    mapping(uint8 => LevelConfig) private levels;
    mapping(uint256 => LightScore) public scores;
    mapping(uint8 => uint256[]) private pools;
    mapping(address => mapping(uint8 => Best)) public best;
    mapping(uint8 => bytes32[10]) private boards;
    mapping(address => uint32) public lightGiven;
    mapping(address => address) public operatorOf;
    mapping(address => address) public pendingOperatorOf;
    uint256 public scoreCount;

    error BadLevel();
    error LevelFrozen();
    error BadScore();
    error BadBorrow();
    error BadInputs();
    error Fell(uint16 tick, uint8 gap);
    error TimeUp();
    error BadOperator();
    error TransferFailed();

    event LevelSet(uint8 indexed level);
    event RunCleared(address indexed player, uint8 indexed level, uint256 indexed scoreId,
        uint16 finishTick, uint8 stars, uint256 borrowedId, bool hasItem);
    event LightLent(address indexed author, uint8 indexed level, uint256 indexed scoreId);
    event OperatorProposed(address indexed player, address indexed burner);
    event OperatorAuthorized(address indexed player, address indexed burner);
    event OperatorRevoked(address indexed player, address indexed burner);
    event Thanked(address indexed sender, uint256 indexed scoreId, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @dev Each level is immutable once configured: historical records always use the same rules.
    function setLevel(uint8 id, LevelConfig calldata cfg) external onlyOwner {
        if (id == 0 || id > 5 || cfg.beats == 0 || cfg.beats > 32 || cfg.beatTicks == 0
            || uint256(cfg.beats) * cfg.beatTicks > 1024 || cfg.speed == 0
            || cfg.minX > cfg.startX || cfg.startX >= cfg.bellX || cfg.bellX > cfg.maxX
            || cfg.lampCount == 0 || cfg.lampCount > 32 || cfg.gaps.length > 16
            || cfg.maxSwitches >= cfg.beats || cfg.par3 > cfg.par2
            || cfg.par2 > uint256(cfg.beats) * cfg.beatTicks
            || (cfg.itemRequired && !cfg.hasItem)
            || (cfg.hasItem && (cfg.itemTicks == 0 || cfg.itemX < cfg.minX || cfg.itemX > cfg.maxX))) revert BadLevel();
        if (levels[id].beats != 0) revert LevelFrozen();
        uint256 lastB;
        for (uint256 i; i < cfg.gaps.length; ++i) {
            uint256 g = cfg.gaps[i];
            uint256 a = uint16(g);
            uint256 b = uint16(g >> 16);
            uint256 kind = uint8(g >> 32);
            uint256 lamp = uint8(g >> 40);
            if (a >= b || a < cfg.minX || b > cfg.maxX || a < lastB || kind > 1
                || (kind == 0 && (lamp == 0 || lamp > cfg.lampCount)) || g >> 80 != 0) revert BadLevel();
            lastB = b;
        }
        levels[id] = cfg;
        emit LevelSet(id);
    }

    function getLevel(uint8 id) external view returns (LevelConfig memory) { return _level(id); }
    function getScore(uint256 id) external view returns (LightScore memory) { return scores[id]; }

    function getPool(uint8 level, uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, LightScore[] memory items)
    {
        uint256 length = pools[level].length;
        uint256 count = offset >= length ? 0 : length - offset;
        if (count > limit) count = limit;
        if (count > 100) count = 100;
        ids = new uint256[](count);
        items = new LightScore[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = pools[level][offset + i];
            items[i] = scores[ids[i]];
        }
    }

    function getBest(address player) external view returns (Best[5] memory result) {
        for (uint8 i; i < 5; ++i) result[i] = best[player][i + 1];
    }

    function getBoard(uint8 level) external view returns
        (address[] memory players, uint16[] memory ticks, uint8[] memory stars)
    {
        bytes32[10] memory data = boards[level];
        uint256 count;
        while (count < 10 && data[count] != 0) ++count;
        players = new address[](count); ticks = new uint16[](count); stars = new uint8[](count);
        for (uint256 i; i < count; ++i) {
            uint256 entry = uint256(data[i]);
            players[i] = address(uint160(entry >> 24));
            ticks[i] = uint16(entry >> 8);
            stars[i] = uint8(entry);
        }
    }

    function submitRun(uint8 level, bytes calldata score, bytes calldata inputs, uint256 borrowedId)
        external returns (uint256 scoreId)
    {
        LevelConfig memory cfg = _level(level);
        _validateScore(cfg, score);
        bytes32 borrowed;
        if (borrowedId != 0) {
            LightScore memory source = scores[borrowedId];
            if (!cfg.borrowable || source.author == address(0) || source.level != level) revert BadBorrow();
            borrowed = source.score;
        }
        (uint16 tick, bool hasItem) = _replay(cfg, bytes32(score), borrowed, inputs);
        address player = _player();
        scoreId = _save(player, level, score, tick, cfg.borrowable);
        uint8 stars = tick <= cfg.par3 ? 3 : tick <= cfg.par2 ? 2 : 1;
        if (borrowedId != 0) {
            ++scores[borrowedId].borrowCount;
            ++lightGiven[scores[borrowedId].author];
        }
        Best memory previous = best[player][level];
        if (previous.tick == 0 || tick < previous.tick) {
            best[player][level] = Best(tick, stars, uint32(scoreId));
            _rank(level, player, tick, stars);
        }
        emit RunCleared(player, level, scoreId, tick, stars, borrowedId, hasItem);
    }

    function lendLight(uint8 level, bytes calldata score) external returns (uint256 scoreId) {
        LevelConfig memory cfg = _level(level);
        if (!cfg.borrowable) revert BadBorrow();
        _validateScore(cfg, score);
        address player = _player();
        scoreId = _save(player, level, score, 0, true);
        emit LightLent(player, level, scoreId);
    }

    /// @notice Read-only replay for clients and shared test vectors; no claim is stored.
    function previewRun(uint8 level, bytes calldata score, bytes calldata inputs, bytes calldata borrowed)
        external view returns (uint16 finishTick, bool hasItem)
    {
        LevelConfig memory cfg = _level(level);
        _validateScore(cfg, score);
        if (borrowed.length != 0) {
            if (!cfg.borrowable) revert BadBorrow();
            _validateScore(cfg, borrowed);
        }
        return _replay(cfg, bytes32(score), bytes32(borrowed), inputs);
    }

    /// @dev A proposal does NOT redirect a wallet's scores. The burner must consent via acceptOperator.
    function authorizeAndFund(address burner) external payable nonReentrant {
        if (burner == address(0) || burner == msg.sender || operatorOf[burner] != address(0)
            || operatorOf[msg.sender] != address(0)) revert BadOperator();
        pendingOperatorOf[burner] = msg.sender;
        if (msg.value != 0) {
            (bool ok,) = burner.call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }
        emit OperatorProposed(msg.sender, burner);
    }

    function acceptOperator(address player) external {
        if (player == address(0) || pendingOperatorOf[msg.sender] != player
            || operatorOf[msg.sender] != address(0) || operatorOf[player] != address(0)) revert BadOperator();
        delete pendingOperatorOf[msg.sender];
        operatorOf[msg.sender] = player;
        emit OperatorAuthorized(player, msg.sender);
    }

    function revoke(address burner) external {
        if (operatorOf[burner] != msg.sender && pendingOperatorOf[burner] != msg.sender) revert BadOperator();
        if (operatorOf[burner] == msg.sender) delete operatorOf[burner];
        if (pendingOperatorOf[burner] == msg.sender) delete pendingOperatorOf[burner];
        emit OperatorRevoked(msg.sender, burner);
    }

    function thank(uint256 scoreId) external payable nonReentrant {
        address author = scores[scoreId].author;
        if (author == address(0) || msg.value == 0) revert BadBorrow();
        (bool ok,) = author.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
        emit Thanked(msg.sender, scoreId, msg.value);
    }

    function _player() private view returns (address) {
        address principal = operatorOf[msg.sender];
        return principal == address(0) ? msg.sender : principal;
    }

    function _level(uint8 id) private view returns (LevelConfig memory cfg) {
        cfg = levels[id];
        if (cfg.beats == 0) revert BadLevel();
    }

    function _validateScore(LevelConfig memory cfg, bytes calldata score) private pure {
        if (score.length != cfg.beats) revert BadScore();
        uint256 changes;
        for (uint256 i; i < score.length; ++i) {
            if (uint8(score[i]) == 0 || uint8(score[i]) > cfg.lampCount) revert BadScore();
            if (i != 0 && score[i] != score[i - 1]) ++changes;
        }
        if (changes > cfg.maxSwitches) revert BadScore();
    }

    function _replay(LevelConfig memory cfg, bytes32 score, bytes32 borrowed, bytes calldata inputs)
        private pure returns (uint16 finishTick, bool hasItem)
    {
        // setLevel bounds all values: <= 1,024 ticks, uint16 positions/speed, <= 16 gaps.
        // All subtractions are guarded below, so checked arithmetic inside this hot loop is redundant.
        unchecked {
        uint256 total = uint256(cfg.beats) * cfg.beatTicks;
        if (inputs.length > total) revert BadInputs();
        // Validate even trailing input after a win, so malformed evidence is never accepted.
        for (uint256 i; i < inputs.length; ++i) if (uint8(inputs[i]) > 3) revert BadInputs();
        uint256 x = cfg.startX;
        uint256 speed = cfg.speed;
        uint256 minX = cfg.minX;
        uint256 maxX = cfg.maxX;
        uint256 bellX = cfg.bellX;
        bool itemRequired = cfg.itemRequired;
        uint256 busy;
        uint256 tick;
        uint256[] memory unsafeGaps = new uint256[](cfg.gaps.length);
        // Light and tide do not change within a beat. Resolve unsafe gaps once per beat,
        // while movement, pickup, hazards and the bell still execute every 50 ms tick.
        for (uint256 beat; beat < cfg.beats; ++beat) {
          uint256 unsafeCount;
          for (uint256 j; j < cfg.gaps.length; ++j) {
            uint256 g = cfg.gaps[j];
            bool safe = uint8(g >> 32) == 0
                ? uint8(score[beat]) == uint8(g >> 40) || uint8(borrowed[beat]) == uint8(g >> 40)
                : ((g >> (48 + beat)) & 1) == 1;
            if (!safe) unsafeGaps[unsafeCount++] = g | (j << 80);
          }
          for (uint256 frame; frame < cfg.beatTicks; ++frame) {
            uint8 action = tick < inputs.length ? uint8(inputs[tick]) : 0;
            if (busy > 0) {
                --busy;
                if (busy == 0) hasItem = true;
            } else if (action == 1) {
                x += speed;
                if (x > maxX) x = maxX;
            } else if (action == 2) {
                x = x > minX + speed ? x - speed : minX;
            } else if (action == 3 && cfg.hasItem && !hasItem
                && (x > cfg.itemX ? x - cfg.itemX : cfg.itemX - x) <= cfg.itemRadius) {
                busy = cfg.itemTicks;
            }
            for (uint256 j; j < unsafeCount; ++j) {
                uint256 g = unsafeGaps[j];
                if (x <= uint16(g)) break;
                if (x < uint16(g >> 16)) revert Fell(uint16(tick), uint8(g >> 80));
            }
            if (x >= bellX && (!itemRequired || hasItem)) return (uint16(tick + 1), hasItem);
            ++tick;
          }
        }
        revert TimeUp();
        }
    }

    function _save(address player, uint8 level, bytes calldata score, uint16 tick, bool pool)
        private returns (uint256 id)
    {
        id = ++scoreCount;
        if (id > type(uint32).max) revert BadScore();
        scores[id] = LightScore(player, level, tick, 0, bytes32(score));
        if (pool) pools[level].push(id);
    }

    function _rank(uint8 level, address player, uint16 tick, uint8 stars) private {
        bytes32[10] memory list = boards[level];
        // Remove this player's previous record; each address occupies at most one place.
        for (uint256 i; i < 10; ++i) {
            if (address(uint160(uint256(list[i]) >> 24)) == player) {
                for (uint256 j = i; j < 9; ++j) list[j] = list[j + 1];
                list[9] = 0;
                break;
            }
        }
        for (uint256 i; i < 10; ++i) {
            if (list[i] == 0 || tick < uint16(uint256(list[i]) >> 8)) {
                for (uint256 j = 9; j > i; --j) list[j] = list[j - 1];
                list[i] = bytes32((uint256(uint160(player)) << 24) | (uint256(tick) << 8) | stars);
                break;
            }
        }
        for (uint256 i; i < 10; ++i) if (boards[level][i] != list[i]) boards[level][i] = list[i];
    }
}
