/*
  Author: Soham Zemse (https://github.com/zemse)

  In this file you should write tests for your smart contract as you progress in developing your smart contract. For reference of Mocha testing framework, you can check out https://devdocs.io/mocha/.
*/

/// @dev importing packages required
const assert = require('assert');
const ethers = require('ethers');
const ganache = require('ganache-cli');

/// @dev connecting to a Era Swap Network Node
const { GetProof } = require('eth-proof');
const esnNodeUrl = 'http://13.127.185.136:80';
const getProof = new GetProof(esnNodeUrl);

/// @dev initialising development blockchain
const provider = new ethers.providers.Web3Provider(ganache.provider({ gasLimit: 8000000 }));
const providerESN = new ethers.providers.JsonRpcProvider(esnNodeUrl);

/// @dev importing build file
const plasmaManagerJSON = require('../build/PlasmaManager_PlasmaManager.json');
const esJSON = require('../build/ERC20_ERC20.json');

/// @dev initialize global variables
let accounts, esInstance, plasmaManagerInstance;

const bunchDepthCases = [1,2,3,2,1]; // bunch cases will be prepared according to this.
// proofs will be generated for this transaction on ESN.
const provingTxHash = '0xec45c3c6b3f392a54bddad672c3d9eb12fb190a16d082bbd774e70f5ce8e6723';

// preparing bunch cases
let tempStartBlockNumber = 0; // for setting the start blocknumber
const bunchCases = bunchDepthCases.map(bunchDepth => {
  const bunchCase = {
    startBlockNumber: ethers.utils.bigNumberify(tempStartBlockNumber).toHexString(),
    bunchDepth: ethers.utils.bigNumberify(bunchDepth).toHexString(),
  }
  tempStartBlockNumber += 2**bunchDepth;
  return bunchCase;
});
console.log({bunchCases});

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

async function getBunchIndex(txHash) {
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

async function parseTx(tx) {
  const r = await (await tx).wait();
  const gasUsed = r.gasUsed.toNumber();
  console.group();
  console.log(`Gas used: ${gasUsed} / ${ethers.utils.formatEther(r.gasUsed.mul(ethers.utils.parseUnits('1','gwei')))} ETH / ${gasUsed / 50000} ERC20 transfers`);
  r.logs.forEach((log, i) => {
    // console.log(i, 'data', log.data);
    const output = plasmaManagerInstance.interface.parseLog(log)
     || esInstance.interface.parseLog(log);
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

/// @dev this is a test case collection
describe('Ganache Setup', async() => {

  /// @dev this is a test case. You first fetch the present state, and compare it with an expectation. If it satisfies the expectation, then test case passes else an error is thrown.
  it('initiates ganache and generates a bunch of demo accounts', async() => {

    /// @dev for example in this test case we are fetching accounts array.
    accounts = await provider.listAccounts();

    /// @dev then we have our expection that accounts array should be at least having 1 accounts
    assert.ok(accounts.length >= 1, 'atleast 2 accounts should be present in the array');
  });
});

describe('Era Swap Token setup', async() => {
  it('deploys ERC20 contract', async() => {
    const ESContractFactory = new ethers.ContractFactory(
      esJSON.abi,
      esJSON.evm.bytecode.object,
      provider.getSigner(accounts[0])
    );
    esInstance =  await ESContractFactory.deploy();
  });
});

/// @dev this is another test case collection
describe('Plasma Manager Contract', () => {

  /// @dev describe under another describe is a sub test case collection
  describe('Plasma Manager Setup', async() => {

    /// @dev this is first test case of this collection
    it('deploys Plasma Manager contract from first account', async() => {

      /// @dev you create a contract factory for deploying contract. Refer to ethers.js documentation at https://docs.ethers.io/ethers.js/html/
      // console.log(plasmaManagerJSON.abi);

      console.log({bytecodelength: plasmaManagerJSON.evm.bytecode.object.length});
      // console.log({bytecode: plasmaManagerJSON.evm.bytecode.object});
      const PlasmaManagerContractFactory = new ethers.ContractFactory(
        plasmaManagerJSON.abi,
        plasmaManagerJSON.evm.bytecode.object,
        provider.getSigner(accounts[0])
      );
      plasmaManagerInstance =  await PlasmaManagerContractFactory.deploy(
        [accounts[0], accounts[1], accounts[2]],
        esInstance.address
      );
      const receipt = await plasmaManagerInstance.deployTransaction.wait();
      console.log({gasUsed: receipt.cumulativeGasUsed.toNumber()});

      assert.ok(plasmaManagerInstance.address, 'conract address should be present');
    });

    /// @dev this is second test case of this collection
    it('validators should be set properly while deploying', async() => {

      /// @dev you access the value at storage with ethers.js library of our custom contract method called getValue defined in contracts/SimpleStorage.sol
      const validators = await plasmaManagerInstance.functions.getAllValidators();

      console.log('validators', validators);

      /// @dev then you compare it with your expectation value
      validators.forEach(
        (address, index) => assert.equal(address, accounts[index], `Validator at index ${index} should be properly set`));
    });

    it('transfering some ES to plasma manager contract', async() => {
      await parseTx(
        esInstance.functions.transfer(plasmaManagerInstance.address, ethers.utils.parseEther('1000000'))
      );
    });
  });

  describe('Plasma Manager Functionality', async() => {

    bunchCases.forEach(bunchCase => {
      it('should be able to submit a bunch header', async() => {
        console.log('Submitting Bunch Header');
        // const header = '0x' + startBlockNumber.slice(2) + bunchDepth.slice(2) + transactionsMegaRoot.slice(2);

        if(!bunchCase.transactionsMegaRoot) {
          bunchCase.transactionsMegaRoot = await fetchBlocksAndReturnMegaRoot(+bunchCase.startBlockNumber, +bunchCase.bunchDepth);
          console.log({txMegaRoot: bunchCase.transactionsMegaRoot});
        }

        const headerArray = [
          bunchCase.startBlockNumber,
          bunchCase.bunchDepth,
          bunchCase.transactionsMegaRoot,
          bunchCase.receiptsMegaRoot || ethers.constants.HashZero
        ];
        // console.log({headerArray});

        const headerRLP = ethers.utils.RLP.encode(headerArray);

        const fullArray = [headerArray];

        for(let i = 1; i <= 2; i++) {
          const signer = provider.getSigner(accounts[i]);
          const signature = await signer.signMessage(ethers.utils.arrayify(headerRLP));
          fullArray.push(signature);
        }

        const fullRLP = ethers.utils.RLP.encode(fullArray);

        console.log({fullArray});

        const receipt = await parseTx(plasmaManagerInstance.functions.submitBunchHeader(fullRLP));
        const parsedLog = plasmaManagerInstance.interface.parseLog(receipt.logs[3]);
        const index = parsedLog.values._bunchIndex.toNumber();

        const bunchHeader = await plasmaManagerInstance.functions.bunches(index);
        Object.entries(removeNumericKeysFromStruct(bunchHeader)).forEach((entry, i) => {
          const errorMessage = `Bunch header submission mismatch for ${entry[0]}`;
          if(entry[1] instanceof ethers.utils.BigNumber) {
            assert.ok(entry[1].eq(headerArray[i]), errorMessage);
          } else {
            assert.equal(entry[1], headerArray[i], errorMessage);
          }
        });
      });
    });

    it('generate and send proof', async() => {
      console.log('Sending Proof');
      const merklePatriciaProofObj = await getProof.transactionProof(provingTxHash);

      // console.log({merklePatriciaProofObj});
      const bunchIndexOfTransaction = await getBunchIndex(provingTxHash);
      console.log({bunchIndexOfTransaction});

      if(bunchIndexOfTransaction === null) assert.ok(false, 'transaction hash not yet on plasma');

      const txObj = await providerESN.getTransaction(provingTxHash);
      console.log({txObj});

      const bunchStruct = await plasmaManagerInstance.functions.bunches(bunchIndexOfTransaction);

      const bunchIndexOfTransactionHex = '0x' + bunchIndexOfTransaction.toString(16);
      const blockNumber = '0x' + txObj.blockNumber.toString(16);
      const proofOfBlockInclusionInBunch = await getProofOfBunchInclusion(
        bunchStruct.startBlockNumber,
        bunchStruct.bunchDepth,
        txObj.blockNumber
      );
      const txRoot = '0x' + merklePatriciaProofObj.header[4].toString('hex')
      const rawTransaction = txObj.raw;
      const path = '0x00' + merklePatriciaProofObj.txIndex.slice(2);
      const parentNodes = ethers.utils.RLP.encode(merklePatriciaProofObj.txProof)

      const completeProofArray = [
        bunchIndexOfTransactionHex,
        blockNumber,
        proofOfBlockInclusionInBunch,
        txRoot,
        rawTransaction,
        path,
        parentNodes
      ];
      const completeProofRLP = ethers.utils.RLP.encode(completeProofArray);
      console.log({completeProofArray,completeProofRLP});

      await parseTx(
        plasmaManagerInstance.functions.claimWithdrawal(completeProofRLP)
      );
    });

    it('checking parseTransaction with a tx without chain id', async() => {
      const parsedTx = await plasmaManagerInstance.functions.parseTransaction('0xf86982119e80827530943d2bb9d34d96307942b7cce133bbf1aad361c5298817908200ec9d0000801ca08f38797a9013772c45e890a56bc82c24c51d06f895546fc80177754b01e7ce57a06da71f056b58608be916174b53e687c2bd3eddc6900f5f520be4c69d0a138fea');
      console.log({parsedTx});

      assert.equal(parsedTx[0], '0xC8e1F3B9a0CdFceF9fFd2343B943989A22517b26', 'signer address should be correct');
      assert.ok(parsedTx[1].eq(ethers.utils.parseEther('1.698')), 'signer address should be correct');
    });
  });
});
