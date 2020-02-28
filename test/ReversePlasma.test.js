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
const nodeUrl = 'https://kovan.infura.io/v3/b915fe11a8ab4e73a3edba4c59d656b2';
const getProof = new GetProof(nodeUrl);

const { parseTx } = require('../helpers');

/// @dev initialising development blockchain
const provider = new ethers.providers.Web3Provider(ganache.provider({ gasLimit: 8000000 }));
const providerETH = new ethers.providers.JsonRpcProvider(nodeUrl);

/// @dev importing build file
const reversePlasmaJSON = require('../build/ReversePlasma_ReversePlasma.json');

/// @dev initialize global variables
let accounts, reversePlasmaInstance;

const depositTxHash = '0xf2d199df08acc5ba804cae09f643a86377ac74211405840dc656786a63829a3c';
const depositAddress = '0x1031a1C7Cc8edc64Cae561DcEA4285f8ab97e02F';
const tokenAddress = '0x53E750ee41c562C171D65Bcb51405b16a56cF676';

const blockHeaders = [
  {
    blockNumber: 16990339,
    transactionsRoot: '0x9a003ea86883a49607e584c0140568e23d9ab17209a83e60ea103c17fd50c98c',
    receiptsRoot: '0x4b3e30a74c0683b20fbd21fea6d14bc4248e26312ddb02861651534321c89d0d'
  }
];

function getPathFromTransactionIndex(number) {
  if(typeof number !== 'number') {
    return null;
  }
  if(number === 0) {
    return '0x0080';
  }
  const hex = number.toString(16);
  // return '0x'+(hex.length%2?'00':'1')+hex;
  return '0x'+'00'+hex;
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

/// @dev this is another test case collection
describe('Reverse Plasma Contract', () => {

  /// @dev describe under another describe is a sub test case collection
  describe('Reverse Plasma Setup', async() => {

    /// @dev this is first test case of this collection
    it('deploys Reverse Plasma contract from first account', async() => {

      /// @dev you create a contract factory for deploying contract. Refer to ethers.js documentation at https://docs.ethers.io/ethers.js/html/
      // console.log(reversePlasmaJSON.abi);

      console.log({bytecodelength: reversePlasmaJSON.evm.bytecode.object.length});
      // console.log({bytecode: reversePlasmaJSON.evm.bytecode.object});
      const ReversePlasmaContractFactory = new ethers.ContractFactory(
        reversePlasmaJSON.abi,
        reversePlasmaJSON.evm.bytecode.object,
        provider.getSigner(accounts[0])
      );
      reversePlasmaInstance =  await ReversePlasmaContractFactory.deploy(
        [accounts[0], accounts[1], accounts[2]],
        tokenAddress
      );
      const receipt = await reversePlasmaInstance.deployTransaction.wait();
      console.log({gasUsed: receipt.cumulativeGasUsed.toNumber()});

      assert.ok(reversePlasmaInstance.address, 'conract address should be present');
    });

    /// @dev this is second test case of this collection
    it('validators should be set properly while deploying', async() => {

      for(const address of [accounts[0], accounts[1], accounts[2]]) {
        const validatorStatus = await reversePlasmaInstance.functions.isValidator(address);

        assert.ok(validatorStatus, `Validator ${address} should be properly set`)
      }
    });

    it('era swap contract address should be set properly', async() => {
      const tokenOutput = await reversePlasmaInstance.functions.token();
      assert.equal(tokenOutput, tokenAddress, 'mainnet deposit address should be set properly');
    });

    it('setting deposit address', async() => {
      await parseTx(
        reversePlasmaInstance.functions.updateDepositAddress(depositAddress)
      );
      const depositAddressOutput = await reversePlasmaInstance.functions.depositAddress();
      assert.equal(depositAddressOutput, depositAddress, 'reverse plasma address should be set properly')
    });
  });

  describe('Reverse Plasma Functionality', async() => {

    blockHeaders.forEach(blockHeader => {
      it('submitting block header', async() => {
        const blockNumber = ethers.utils.hexZeroPad('0x'+blockHeader.blockNumber.toString(16), 32);
        const packedHeader = ethers.utils.hexlify(ethers.utils.concat([blockNumber, blockHeader.transactionsRoot, blockHeader.receiptsRoot]));
        await parseTx(reversePlasmaInstance.functions.submitBlockHeader(packedHeader));
      });
    });

    it('submit deposit proof', async() => {
      console.log(1);
      const txObj = await providerETH.getTransaction(depositTxHash);
      console.log({txObj})

      const txReceiptObj = await providerETH.getTransactionReceipt(depositTxHash);

      const receipt = [
        '0x'+Number(txReceiptObj.status || txReceiptObj.root).toString(16),
        txReceiptObj.cumulativeGasUsed.toHexString(),
        txReceiptObj.logsBloom,
        txReceiptObj.logs.map(log => {
          return [
            log.address,
            log.topics,
            log.data
          ];
        })
      ];
      console.log({receipt});

      const merklePatriciaProofObj = await getProof.transactionProof(depositTxHash);
      const merklePatriciaProofObj2 = await getProof.receiptProof(depositTxHash);
      console.log({merklePatriciaProofObj, merklePatriciaProofObj2});

      // const txRoot = '0x' + merklePatriciaProofObj.header[4].toString('hex')
      const blockNumber = '0x'+txObj.blockNumber.toString(16);
      const path = getPathFromTransactionIndex(+merklePatriciaProofObj.txIndex);

      const rawTransaction = txObj.raw;
      const parentNodesTx = ethers.utils.RLP.encode(merklePatriciaProofObj.txProof);

      const rawReceipt = ethers.utils.RLP.encode(receipt);
      const parentNodesReceipt = ethers.utils.RLP.encode(merklePatriciaProofObj2.receiptProof);

      const proof = [
        blockNumber,
        path,
        rawTransaction,
        parentNodesTx,
        rawReceipt,
        parentNodesReceipt
      ];

      await parseTx(
        reversePlasmaInstance.functions.claimDeposit(
          ethers.utils.RLP.encode(proof)
        )
      );
    });
  });
});
