// here we input the starting block number, bunch depth and the blocknubmer
const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider('http://13.127.185.136:80');
// const startBlockNumber = 0;
// const bunchDepth = 4;
const startBlockNumber = Number(process.argv[2]);
const bunchDepth = Number(process.argv[3]);

const proofofInclusionForBlockNumber = Number(process.argv[4]);

const blockNumbersToScan = [...Array(2**bunchDepth).keys()];
// console.log(blockNumbersToScan);

const blockArray = new Array(2**bunchDepth);

function getProofOfBunchInclusion(inputArray, index, proof = '0x') {
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
      console.log(accumulator+' '+(currentValue).slice(2));
      reducedArray.push(ethers.utils.keccak256(accumulator+(currentValue).slice(2)));
      return null;
    } else {
      return currentValue;
    }
  });

  return getProofOfBunchInclusion(reducedArray, Math.floor(index/2), proof);
}

(async() => {
  await Promise.all(blockNumbersToScan.map(number => {
    return new Promise(async function(resolve, reject) {
      const block = await provider.send('eth_getBlockByNumber', [
        ethers.utils.hexStripZeros(ethers.utils.hexlify(number)),
        true
      ]);
      blockArray[number] = ({
        blockNumber: number,
        transactionsRoot: block.transactionsRoot,
        receiptsRoot: block.receiptsRoot
      });
      // console.log(typeof number)
      resolve();
    });
  }))

  // console.log(blockArray);

  let txRootArray = blockArray.map(block => block.transactionsRoot);
  console.log('txRootArray', txRootArray);

  console.log('getProofOfBunchInclusion', getProofOfBunchInclusion(txRootArray, proofofInclusionForBlockNumber));

})();
