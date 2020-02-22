// here start block number, bunch depth, bunch root would be available in smart contract as trusted source
// user will input a tx root, index of tx in the bunch, and proof of inclusion which will return true or false

const ethers = require('ethers');

const BLOCK_HEADER = {
  START_BLOCK_NUMBER: 0,
  BUNCH_DEPTH: 3,
  TX_MEGA_ROOT: '0x2fab0c864cc829f6a24fd69db5e9a8057413fd86e3f9e9e997825d780259508e'
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

const txRoot = process.argv[3] || '0x637d0a967d87afee13c1523c7cab9018d3fe3fad9ee709ab499f104f85f7c7ee';
const blockNumberToVerify = +process.argv[4] || 2;
const proofOfInclusion = process.argv[2] || '0x637d0a967d87afee13c1523c7cab9018d3fe3fad9ee709ab499f104f85f7c7ee64bbca4f5db3b9a11d767673cbb0bb8c0f8524a0f864b918dc5b0a4c367c21ab2922c92699ee1dc81ad68d1adbf7bbae37a965c00b9a2c1ae1ca831a2ae2d081';

console.log(
  verifyTxRootAgainTxMegaRoot(
    BLOCK_HEADER.TX_MEGA_ROOT,
    BLOCK_HEADER.BUNCH_DEPTH,
    txRoot,
    blockNumberToVerify - BLOCK_HEADER.START_BLOCK_NUMBER,
    proofOfInclusion
  )
);
