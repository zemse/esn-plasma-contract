/*
  Author: Soham Zemse (https://github.com/zemse)

  In this file you should write tests for your smart contract as you progress in developing your smart contract. For reference of Mocha testing framework, you can check out https://devdocs.io/mocha/.
*/

/// @dev importing packages required
const assert = require('assert');
const ethers = require('ethers');
const ganache = require('ganache-cli');

/// @dev initialising development blockchain
const provider = new ethers.providers.Web3Provider(ganache.provider({ gasLimit: 8000000 }));

/// @dev importing build file
const plasmaManagerJSON = require('../build/PlasmaManager_PlasmaManager.json');

/// @dev initialize global variables
let accounts, plasmaManagerInstance;

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
      const PlasmaManagerContractFactory = new ethers.ContractFactory(
        plasmaManagerJSON.abi,
        plasmaManagerJSON.evm.bytecode.object,
        provider.getSigner(accounts[0])
      );
      plasmaManagerInstance =  await PlasmaManagerContractFactory.deploy([
        accounts[0], accounts[1], accounts[2]
      ]);

      assert.ok(plasmaManagerInstance.address, 'conract address should be present');
    });

    /// @dev this is second test case of this collection
    it('validators should be set properly while deploying', async() => {

      /// @dev you access the value at storage with ethers.js library of our custom contract method called getValue defined in contracts/SimpleStorage.sol
      const validators = await plasmaManagerInstance.functions.getAllValidators();

      console.log('validators', validators);

      /// @dev then you compare it with your expectation value
      validators.forEach((address, index) => assert.equal(address, accounts[index], `Validator at index ${index} should be properly set`));
    });
  });

  describe('Plasma Manager Functionality', async() => {

    /// @dev this is first test case of this collection
    it('should be able to submit a bunch header', async() => {

      /// @dev you sign and submit a transaction to local blockchain (ganache) initialized on line 10.

      const startBlockNumber = ethers.utils.bigNumberify(1000).toHexString();
      const bunchDepth = ethers.utils.bigNumberify(1000).toHexString();
      const transactionsMegaRoot = '0x0bcad17ecf260d6506c6b97768bdc2acfb6694445d27ffd3f9c1cfbee4a9bd6d';

      const header = '0x' + startBlockNumber.slice(2) + bunchDepth.slice(2) + transactionsMegaRoot.slice(2);
      let signatures = '0x';
      for(let i = 0; i <= 2; i++) {
        const signer = provider.getSigner(accounts[i]);
        const signat = await signer.signMessage(ethers.utils.arrayify(header));
        // console.log('signat', signat);
        signatures += signat.slice(2);
      }

      console.log(signatures);

      const tx = await plasmaManagerInstance.functions.submitBunchHeader(header, signatures);

      const signers = await plasmaManagerInstance.functions.getAllSigners();
      console.log('signers', signers);
    });
  });
});
