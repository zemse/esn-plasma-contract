const fs = require('fs');
const path = require('path')
const ethers = require('ethers');

/// @dev connecting to a Era Swap Network Node
const { GetProof } = require('eth-proof');
const esnNodeUrl = 'http://13.127.185.136:80';
const getProof = new GetProof(esnNodeUrl);

const providerESN = new ethers.providers.JsonRpcProvider(esnNodeUrl);

function removeNumericKeysFromStruct(inputStruct) {
  return Object.fromEntries(Object.entries(inputStruct).filter((entry, i) => {
    if(entry[0] === 'length') return false;
    if(entry[0] === String(i)) return false;
    return true;
  }));
}

async function fetchBlocksAndReturnMegaRoot(startBlockNumber, bunchDepth) {
  if(startBlockNumber instanceof ethers.utils.BigNumber) startBlockNumber = startBlockNumber.toNumber();
  if(bunchDepth instanceof ethers.utils.BigNumber) bunchDepth = bunchDepth.toNumber();
  function getMegaRoot(inputArray) {
    if(inputArray.length === 1) return inputArray[0];

    if(inputArray.length && (inputArray.length & (inputArray.length-1)) !== 0) {
      throw new Error('inputArray should be of length of power 2');
    }
    const reducedArray = [];
    inputArray.reduce((accumulator, currentValue) => {
      if(accumulator) {
        // reducedArray.push(`[${accumulator}===${currentValue}]`);
        // console.log(accumulator+' '+(currentValue).slice(2));
        reducedArray.push(ethers.utils.keccak256(accumulator+(currentValue).slice(2)));
        return null;
      } else {
        return currentValue;
      }
    });
    return getMegaRoot(reducedArray);
  }

  const blockNumbersToScan = [...Array(2**bunchDepth).keys()].map(n => n + startBlockNumber);
  // console.log({blockNumbersToScan});
  const blockArray = new Array(2**bunchDepth);
  await Promise.all(blockNumbersToScan.map(number => {
    return new Promise(async function(resolve, reject) {
      const blockNumber = ethers.utils.hexStripZeros(ethers.utils.hexlify(number));
      // console.log({blockNumber});
      const block = await providerESN.send('eth_getBlockByNumber', [
        blockNumber,
        true
      ]);
      console.log(`Received block ${number} from ESN node`);
      blockArray[number - startBlockNumber] = ({
        blockNumber: number,
        transactionsRoot: block.transactionsRoot,
        receiptsRoot: block.receiptsRoot
      });
      // console.log(typeof number)
      resolve();
    });
  }));
  const txRootArray = blockArray.map(block => block.transactionsRoot);
  // console.log({blockArray,txRootArray});
  return getMegaRoot(txRootArray);
}

async function getProofOfBunchInclusion(startBlockNumber, bunchDepth, blockNumber) {
  if(startBlockNumber instanceof ethers.utils.BigNumber) startBlockNumber = startBlockNumber.toNumber();
  if(bunchDepth instanceof ethers.utils.BigNumber) bunchDepth = bunchDepth.toNumber();
  if(blockNumber instanceof ethers.utils.BigNumber) blockNumber = blockNumber.toNumber();
  function _getProofOfBunchInclusion(inputArray, index, proof = '0x') {
    // console.log({inputArray});
    if(inputArray.length === 1) return proof;
    if(inputArray.length && (inputArray.length & (inputArray.length-1)) !== 0) {
      throw new Error('inputArray should be of length of power 2');
    }

    // index%2 === 1 (odd) then it must be right side
    // index%2 === 0 (even) then it must be left side

    if(index%2) {
      proof += '' + inputArray[index-1].slice(2);
    } else {
      proof += '' + inputArray[index+1].slice(2);
    }

    // computing hash of two pairs and storing them in reduced array
    const reducedArray = [];
    inputArray.reduce((accumulator, currentValue) => {
      if(accumulator) {
        // reducedArray.push(`[${accumulator}===${currentValue}]`);
        // console.log(accumulator+' '+(currentValue).slice(2));
        reducedArray.push(ethers.utils.keccak256(accumulator+(currentValue).slice(2)));
        return null;
      } else {
        return currentValue;
      }
    });

    return _getProofOfBunchInclusion(reducedArray, Math.floor(index/2), proof);
  }
  const blockNumbersToScan = [...Array(2**bunchDepth).keys()].map(n => n + startBlockNumber);
  // console.log({blockNumbersToScan});
  const blockArray = new Array(2**bunchDepth);

  await Promise.all(blockNumbersToScan.map(number => {
    return new Promise(async function(resolve, reject) {
      const block = await providerESN.send('eth_getBlockByNumber', [
        ethers.utils.hexStripZeros(ethers.utils.hexlify(number)),
        true
      ]);
      blockArray[number - startBlockNumber] = ({
        blockNumber: number,
        transactionsRoot: block.transactionsRoot,
        receiptsRoot: block.receiptsRoot
      });
      // console.log(typeof number)
      resolve();
    });
  }));

  return _getProofOfBunchInclusion(blockArray.map(block => block.transactionsRoot), blockNumber - startBlockNumber);
}

async function getBunchIndex(txHash, plasmaManagerInstance) {
  const txObj = await providerESN.getTransaction(txHash);
  const blockNumber = txObj.blockNumber;
  // console.log({blockNumber});
  const lastBunchIndex = (await plasmaManagerInstance.functions.lastBunchIndex()).toNumber();
  if(lastBunchIndex === 0) return null;
  async function checkMiddle(start, end) {
    const current = Math.floor((start + end)/2);
    // console.log({start, end, current});
    const bunch = await plasmaManagerInstance.functions.bunches(current);
    const startBlockNumber = bunch.startBlockNumber.toNumber();
    const endBlockNumber = bunch.startBlockNumber.toNumber() + 2**bunch.bunchDepth.toNumber();
    // console.log({startBlockNumber, blockNumber, endBlockNumber});
    if(startBlockNumber <= blockNumber && blockNumber <= endBlockNumber) {
      // the block is in bunch with index current
      return current;
    } else if(blockNumber < startBlockNumber) {
      // the block is in a bunch earlier than in bunch with index current
      return checkMiddle(start, Math.floor((start+end)/2));
    } else if(blockNumber > endBlockNumber) {
      // the block is in a bunch later than in bunch with index current
      return checkMiddle(Math.ceil((start+end)/2), end);
    } else if(start === end) {
      // the block is not even in the last bunch
      return null;
    }
  }

  const bunchIndex = await checkMiddle(0, lastBunchIndex - 1);
  return bunchIndex;
}

const interfaceArray = [];
async function parseTx(tx) {
  const r = await (await tx).wait();
  const gasUsed = r.gasUsed.toNumber();
  console.group();
  console.log(`Gas used: ${gasUsed} / ${ethers.utils.formatEther(r.gasUsed.mul(ethers.utils.parseUnits('1','gwei')))} ETH / ${gasUsed / 50000} ERC20 transfers`);

  const buildFolderPath = path.resolve(__dirname, 'build');
  const filesToIgnore = {'.DS_Store': true};

  function loadABIFromThisDirectory(relativePathArray = []) {
    const pathArray = [buildFolderPath, ...relativePathArray];
    fs.readdirSync(path.resolve(buildFolderPath, ...relativePathArray)).forEach(childName => {
      if(filesToIgnore[childName]) return;
      const childPathArray = [...relativePathArray, childName];
      // console.log({childPathArray});
      if(fs.lstatSync(path.resolve(buildFolderPath, ...childPathArray)).isDirectory()) {
        loadABIFromThisDirectory(childPathArray);
      } else {
        const content = JSON.parse(fs.readFileSync(path.resolve(buildFolderPath, ...childPathArray), 'utf8'));
        // console.log({content});
        const iface = new ethers.utils.Interface(content.abi);
        interfaceArray.push(iface);
      }
    });
  }

  if(!interfaceArray.length) loadABIFromThisDirectory();

  r.logs.forEach((log, i) => {
    let output;

    for(const iface of interfaceArray) {
      output = iface.parseLog(log);
      if(output) {
        break;
      }
    }

    if(!output) {
      console.log({log})
    } else {
      const values = removeNumericKeysFromStruct(output.values);
      console.log(i, output.name, values);
    }
  });
  console.groupEnd();
  return r;
}

module.exports = { removeNumericKeysFromStruct, fetchBlocksAndReturnMegaRoot, getProofOfBunchInclusion, getBunchIndex, parseTx };
