/*
  Author: Soham Zemse (https://github.com/zemse)

  In this file you should write tests for your smart contract as you progress in developing your smart contract. For reference of Mocha testing framework, you can check out https://devdocs.io/mocha/.
*/

/// @dev importing packages required
const assert = require('assert');
const ethers = require('ethers');
const ganache = require('ganache-cli');

const fs = require('fs-extra');
const path = require('path');

/// @dev connecting to a Era Swap Network Node
const { GetProof } = require('eth-proof');
const esnNodeUrl = 'http://13.127.185.136:80';
const getProof = new GetProof(esnNodeUrl);

const { removeNumericKeysFromStruct, fetchBlocksAndReturnMegaRoot, getProofOfBunchInclusion, getBunchIndex, parseTx } = require('../helpers');

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
const esnDepositAddress = '0xd5Dd476dE0a26AdB8069fc36537ab3A6b85192a4';

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

    it('setting ESN deposit address', async() => {
      await parseTx(
        plasmaManagerInstance.functions.setESNDepositAddress(esnDepositAddress)
      );
      const esnDepositAddressOutput = await plasmaManagerInstance.functions.esnDepositAddress();
      assert.equal(esnDepositAddressOutput, esnDepositAddress, 'reverse plasma address should be set properly')
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
      const bunchIndexOfTransaction = await getBunchIndex(provingTxHash, plasmaManagerInstance);
      console.log({bunchIndexOfTransaction});

      if(bunchIndexOfTransaction === null) assert.ok(false, 'transaction hash not yet on plasma');

      const txObj = await providerESN.getTransaction(provingTxHash);
      // console.log({txObj});

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
      assert.equal(parsedTx[1], '0x3D2bB9D34D96307942b7cCe133bBF1aAd361C529', 'to address should be correct');
      assert.ok(parsedTx[2].eq(ethers.utils.parseEther('1.698')), 'signer address should be correct');
    });
  });
});
