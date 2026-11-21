const path = require('node:path');
module.exports = {
  solidity: { version: '0.8.28', settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun' } },
  paths: { sources: './contracts', artifacts: './hardhat-artifacts', cache: './cache', tests: './test' },
  networks: { hardhat: { hardfork: 'cancun', chainId: 31337, blockGasLimit: 30000000 } },
};
