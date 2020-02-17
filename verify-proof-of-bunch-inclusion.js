// here start block number, bunch depth, bunch root would be available in smart contract as trusted source
// user will input a tx root, index of tx in the bunch, and proof of inclusion which will return true or false

const ethers = require('ethers');

const BLOCK_HEADER = {
  START_BLOCK_NUMBER: 0,
  BUNCH_DEPTH: 2,
  TX_MEGA_ROOT: '0xbeb71f2befb15738bb8afa37321f4edc7ab0632d44cca6d428406326e9350fac'
};


function verifyTxRootAgainTxMegaRoot(
  txMegaRoot, bunchDepth, txRoot, txRootIndex, proofOfInclusion
) {
  const bunchMaxIndex = 2**bunchDepth - 1;

  if(txRootIndex > bunchMaxIndex) throw new Error('Invalid tx root index');

  if(proofOfInclusion.slice(0,2) === '0x') {
    proofOfInclusion = proofOfInclusion.slice(2);
  }

  if(proofOfInclusion.length%64) throw new Error('Bad Length of the Proof');

  const proofArray = [];

  while(proofOfInclusion) {
    proofArray.push(proofOfInclusion.slice(0,64));
    proofOfInclusion = proofOfInclusion.slice(64);
  }

  // index%2 === 1 (odd) then it must be right side
  // index%2 === 0 (even) then it must be left side

  let hashedString = txRoot;
  let currentIndex = txRootIndex;

  proofArray.forEach(proofElement => {
    if(hashedString.slice(0,2) === '0x') hashedString = hashedString.slice(2);

    if(currentIndex%2) {
      hashedString = proofElement + hashedString;
    } else {
      hashedString = hashedString + proofElement;
    }

    hashedString = ethers.utils.keccak256('0x'+hashedString);
    currentIndex = Math.floor(currentIndex/2);
  });

  return hashedString === txMegaRoot;
}

// const txRoot = process.argv[2];
// const blockNumberToVerify = Number(process.argv[3]);
// const proofOfInclusion = process.argv[4];

const txRoot = '0x637d0a967d87afee13c1523c7cab9018d3fe3fad9ee709ab499f104f85f7c7ee';
const blockNumberToVerify = 2;
const proofOfInclusion = '0xa5b23188a2023f264d28c89a247091fde93ed4cd333148b6d6a6b4a8212b0a2d64bbca4f5db3b9a11d767673cbb0bb8c0f8524a0f864b918dc5b0a4c367c21ab';

console.log(
  verifyTxRootAgainTxMegaRoot(
    BLOCK_HEADER.TX_MEGA_ROOT,
    BLOCK_HEADER.BUNCH_DEPTH,
    txRoot,
    blockNumberToVerify - BLOCK_HEADER.START_BLOCK_NUMBER,
    proofOfInclusion
  )
);
