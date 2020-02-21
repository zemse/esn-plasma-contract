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

/// @dev importing build file
const plasmaManagerJSON = require('../build/PlasmaManager_PlasmaManager.json');

const bunchCases = [
  {
    startBlockNumber: ethers.utils.bigNumberify(0).toHexString(),
    bunchDepth: ethers.utils.bigNumberify(10).toHexString(),
    transactionsMegaRoot: '0x0bcad17ecf260d6506c6b97768bdc2acfb6694445d27ffd3f9c1cfbee4a9bd6d',
    // receiptsMegaRoot: '0x0bcad17ecf260d6506c6b97768bdc2acfb6694445d27ffd3f9c1cfbee4a9bd6d'
  },
  // {
  //   startBlockNumber: ethers.utils.bigNumberify(1024).toHexString(),
  //   bunchDepth: ethers.utils.bigNumberify(10).toHexString(),
  //   transactionsMegaRoot: '0x0bcad17ecf260d6506c6b97768bdc2acfb6694445d27ffd3f9c1cfbee4a9bd6d',
  //   // receiptsMegaRoot: '0x0bcad17ecf260d6506c6b97768bdc2acfb6694445d27ffd3f9c1cfbee4a9bd6d'
  // },
];

/// @dev initialize global variables
let accounts, plasmaManagerInstance;

function removeNumericKeysFromStruct(inputStruct) {
  return Object.fromEntries(Object.entries(inputStruct).filter((entry, i) => {
    if(entry[0] === 'length') return false;
    if(entry[0] === String(i)) return false;
    return true;
  }));
}

async function parseTx(tx) {
  const r = await (await tx).wait();
  const gasUsed = r.gasUsed.toNumber();
  console.group();
  console.log(`Gas used: ${gasUsed} / ${ethers.utils.formatEther(r.gasUsed.mul(ethers.utils.parseUnits('1','gwei')))} ETH / ${gasUsed / 50000} ERC20 transfers`);
  r.logs.forEach((log, i) => {
    // console.log(i, 'data', log.data);
    if(plasmaManagerInstance) {
      const output = plasmaManagerInstance.interface.parseLog(log);
      if(!output) {
        console.log({log})
      } else {
        const values = removeNumericKeysFromStruct(output.values);
        console.log(i, output.name, values);
      }
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

/// @dev this is another test case collection
describe('Plasma Manager Contract', () => {

  /// @dev describe under another describe is a sub test case collection
  describe('Plasma Manager Setup', async() => {

    /// @dev this is first test case of this collection
    it('deploys Plasma Manager contract from first account', async() => {

      /// @dev you create a contract factory for deploying contract. Refer to ethers.js documentation at https://docs.ethers.io/ethers.js/html/
      // console.log(plasmaManagerJSON.abi);

      console.log({bytecodelength: plasmaManagerJSON.evm.bytecode.object.length});
      const PlasmaManagerContractFactory = new ethers.ContractFactory(
        plasmaManagerJSON.abi,
        plasmaManagerJSON.evm.bytecode.object,
        provider.getSigner(accounts[0])
      );
      plasmaManagerInstance =  await PlasmaManagerContractFactory.deploy([
        accounts[0], accounts[1], accounts[2]
      ]);
      const receipt = await plasmaManagerInstance.deployTransaction.wait()
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
  });

  describe('Plasma Manager Functionality', async() => {

    bunchCases.forEach(bunchCase => {
      it('should be able to submit a bunch header', async() => {
        console.log('Submitting Bunch Header');
        // const header = '0x' + startBlockNumber.slice(2) + bunchDepth.slice(2) + transactionsMegaRoot.slice(2);
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

    it('check proof', async() => {
      console.log('Sending Proof');
      const txHash = '0xa0e58a664cbcce35a8d0d2e95a85f1415b54dd130d602e93d221a16c21569b05';
      const merklePatriciaProofObj = await getProof.transactionProof(txHash);

      // console.log({merklePatriciaProofObj});

      const providerESN = new ethers.providers.JsonRpcProvider(esnNodeUrl);
      const txObj = await providerESN.getTransaction(txHash);

      const rawTransaction = txObj.raw;
      const path = '0x00' + merklePatriciaProofObj.txIndex.slice(2);
      const parentNodes = ethers.utils.RLP.encode(merklePatriciaProofObj.txProof)
      const txRoot = '0x' + merklePatriciaProofObj.header[4].toString('hex')

      const completeProofArray = [rawTransaction, path, parentNodes, txRoot];
      const completeProofRLP = ethers.utils.RLP.encode(completeProofArray);

      await parseTx(
        plasmaManagerInstance.functions.claimWithdrawal(completeProofRLP)
      );
    });
  });
});
