// in this we input a starting block and bunch depth, from this we generate merkle root which we call bunch root.
const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider('http://13.127.185.136:80');
const startBlockNumber = 0;
// const bunchDepth = 4;
const bunchDepth = Number(process.argv[2]);

const blockNumbersToScan = [...Array(2**bunchDepth).keys()];
// console.log(blockNumbersToScan);

const blockArray = new Array(2**bunchDepth);
let i = 0;
function getMegaRoot(inputArray) {
  if(inputArray.length === 1) return inputArray[0];

  if(inputArray.length && (inputArray.length & (inputArray.length-1)) !== 0) {
    throw new Error('inputArray should be of length of power 2');
  }
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
  return getMegaRoot(reducedArray);
}

(async() => {
  await Promise.all(blockNumbersToScan.map(number => {
    return new Promise(async function(resolve, reject) {
      const block = await provider.send('eth_getBlockByNumber', [
        ethers.utils.hexStripZeros(ethers.utils.hexlify(number)),
        true
      ]);
      console.log(`Received block ${number} from node`);
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
  console.log('mega of txRootArray', getMegaRoot(txRootArray));

})();
