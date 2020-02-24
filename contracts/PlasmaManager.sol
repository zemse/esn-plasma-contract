pragma solidity 0.6.3;

import 'ERC20.sol';
// import 'lib/ECVerify.sol';
import 'lib/RLP.sol';
import 'lib/Merkle.sol';
import 'lib/MerklePatriciaProof.sol';
import 'lib/RLPEncode.sol';
import 'lib/BytesLib.sol';

// this contract will store block headers
contract PlasmaManager {
  using RLP for bytes;
  using RLP for RLP.RLPItem;

  struct BunchHeader {
    uint256 startBlockNumber;
    uint256 bunchDepth; // number of blocks in bunch is 2^bunchDepth
    bytes32 transactionsMegaRoot;
    bytes32 receiptsMegaRoot;
  }

  uint256 public numberOfValidators;
  mapping(address => bool) public isValidator;
  mapping(bytes32 => bool) public processedWithdrawals;
  address[] public validators;
  address[] public signers;
  BunchHeader[] public bunches;

  bytes constant PERSONAL_PREFIX = "\x19Ethereum Signed Message:\n";
  uint256 constant CHAIN_ID = 0x2323;
  // bytes constant chainId = hex"62fa"; final this chain id

  ERC20 public token;

  /// @dev to avoid confusion, there will a same plasma contract address (deployed by )
  address public esnDepositAddress;

  uint8 public zemse;

  event Bytes(bytes _bytes);
  event BytesM(bytes _bytes, string _m);
  event Byte(byte _byte);
  event Bytes32(bytes32 _bytes32);
  event Bytes32M(bytes32 _bytes32, string _m);
  event Uint256(uint256 _uint256);
  event Uint256M(uint256 _num, string _m);
  event Uint8(uint8 _uint8);
  event Bool(bool _bool);
  event Address(address _address);
  event AddressM(address _address, string _m);
  event NewBunchHeader(
    uint256 _startBlockNumber,
    uint256 _bunchDepth,
    uint256 _bunchIndex
  );

  constructor(address[] memory _validators, ERC20 _token) public {
    for(uint256 _i = 0; _i < _validators.length; _i++) {
      isValidator[_validators[_i]] = true;
    }
    numberOfValidators = _validators.length;
    validators = _validators;

    token = _token;
  }

  function getAllValidators() public view returns (address[] memory) {
    return validators;
  }

  function getAllSigners() public view returns (address[] memory) {
    return signers;
  }

  function lastBunchIndex() public view returns (uint256) {
    return bunches.length;
  }

  function setESNDepositAddress(address _esnDepositAddress) public {
    esnDepositAddress = _esnDepositAddress;
  }

  function submitBunchHeader(bytes memory _signedHeader) public {
    RLP.RLPItem[] memory _fullList = _signedHeader.toRLPItem().toList();
    RLP.RLPItem[] memory _headerArray = _fullList[0].toList();
    require(_headerArray.length == 4, 'bunch header must have 4 members');

    BunchHeader memory _bunchHeader = BunchHeader({
      startBlockNumber: _headerArray[0].toUint(),
      bunchDepth: _headerArray[1].toUint(),
      transactionsMegaRoot: _headerArray[2].toBytes32(),
      receiptsMegaRoot: _headerArray[3].toBytes32()
    });

    require(_bunchHeader.startBlockNumber == getNextStartBlockNumber(), 'invalid start block number');

    bytes memory _headerRLP = _fullList[0].toRLPBytes();

    bytes32 _digest = keccak256(
      abi.encodePacked(
        PERSONAL_PREFIX,
        _getBytesStr(_headerRLP.length),
        _headerRLP
      )
    );

    emit Bytes32(_digest);

    uint256 _numberOfValidSignatures;

    for(uint256 i = 1; i < _fullList.length; i++) {
      bytes memory _signature = _fullList[i].toBytes();

      bytes32 _r;
      bytes32 _s;
      uint8 _v;

      assembly {
        let _pointer := add(_signature, 0x20)
        _r := mload(_pointer)
        _s := mload(add(_pointer, 0x20))
        _v := byte(0, mload(add(_pointer, 0x40)))
        if lt(_v, 27) { _v := add(_v, 27) }
      }

      require(_v == 27 || _v == 28, 'invalid recovery value');

      address _signer = ecrecover(_digest, _v, _r, _s);

      // (bool _success, address _signer) = ECVerify.ecrecovery(_digest, _signature);

      if(isValidator[_signer]) _numberOfValidSignatures++;

      emit Address(_signer);
    }

    require(_numberOfValidSignatures > numberOfValidators * 66 / 100, '66% validators should sign');

    uint256 _bunchIndex = bunches.length;

    bunches.push(_bunchHeader);

    emit NewBunchHeader(_bunchHeader.startBlockNumber, _bunchHeader.bunchDepth, _bunchIndex);
  }

  function claimWithdrawal(
    bytes memory _rawTransactionProof
  ) public {
    RLP.RLPItem[] memory _decodedProof = _rawTransactionProof.toRLPItem().toList();

    uint256 _bunchIndex = _decodedProof[0].toUint();
    uint256 _blockNumber = _decodedProof[1].toUint();
    bytes memory _blockInBunchProof = _decodedProof[2].toBytes();
    bytes32 _txRoot = _decodedProof[3].toBytes32();
    bytes memory _rawTx = _decodedProof[4].toBytes();
    bytes memory _txIndex = _decodedProof[5].toBytes();
    bytes memory _txInBlockProof = _decodedProof[6].toBytes();

    bytes32 _txHash = keccak256(_rawTx);

    require(
      !processedWithdrawals[_txHash]
      , 'Already processed withdrawal for this transaction'
    );

    require(
      MerklePatriciaProof.verify(_rawTx, _txIndex, _txInBlockProof, _txRoot)
      , 'Invalid Merkle Patricia Proof'
    );

    /// now check for bunch inclusion proof
    // bool _outp = verifyMerkleProof(
    // // bool _outp = Merkle.verify(
    //   _txRoot, // data to verify
    //   _blockNumber - bunches[_bunchIndex].startBlockNumber,
    //   bunches[_bunchIndex].transactionsMegaRoot,
    //   _blockInBunchProof
    // );

    require(
      verifyMerkleProof(
        _txRoot, // data to verify
        _blockNumber - bunches[_bunchIndex].startBlockNumber,
        bunches[_bunchIndex].transactionsMegaRoot,
        _blockInBunchProof
      )
      , 'Invalid Merkle Proof'
    );

    (address _signer, address _to, uint256 _value, uint256 _chainId) = parseTransaction(_rawTx);

    require(
      _to == esnDepositAddress,
      'transfer should be made to ESN Deposit Address'
    );
    // require(
    //   _to == address(this),
    //   'transfer should be made to ESN Deposit Address'
    // );

    require(
      _chainId == CHAIN_ID
      , 'invalid chain id of the transaction'
    );

    processedWithdrawals[_txHash] = true;

    token.transfer(_signer, _value);
  }

  function parseTransaction(bytes memory _rawTx) public pure returns (address, address, uint256, uint256) {
    RLP.RLPItem[] memory _txDecoded = _rawTx.toRLPItem().toList();

    address _to = _txDecoded[3].toAddress();
    uint256 _value = _txDecoded[4].toUint();

    uint256 _v = _txDecoded[6].toUint();
    bytes32 _r = _txDecoded[7].toBytes32();
    bytes32 _s = _txDecoded[8].toBytes32();

    bytes[] memory _unsignedTransactionList;

    uint8 _actualV;
    uint256 _chainId;

    if(_v > 28) {
      _unsignedTransactionList = new bytes[](9);
      if(_v % 2 == 0) {
        _actualV = 28;
      } else {
        _actualV = 27;
      }

      _chainId = (_v - _actualV - 8) / 2;

      _unsignedTransactionList[6] = BytesLib.packedBytesFromUint(_chainId);
    } else {
      _unsignedTransactionList = new bytes[](6);
      _actualV = uint8(_v);
    }

    for(uint256 i = 0; i < 6; i++) {
      _unsignedTransactionList[i] = _txDecoded[i].toBytes();
    }

    bytes memory _unsignedTransaction = RLPEncode.encodeList(_unsignedTransactionList);

    address _signer = ecrecover(keccak256(_unsignedTransaction), _actualV, _r, _s);

    return (_signer, _to, _value, _chainId);
  }

  function verifyMerkleProof(
    bytes32 leaf,
    uint256 mainIndex,
    bytes32 rootHash,
    bytes memory proof
  ) public pure returns (bool) {
    bytes32 proofElement;
    bytes32 computedHash = leaf;
    require(proof.length % 32 == 0, "Invalid proof length");

    uint256 index = mainIndex;
    for (uint256 i = 32; i <= proof.length; i += 32) {
      assembly {
        proofElement := mload(add(proof, i))
      }

      if (index % 2 == 0) {
        computedHash = keccak256(
          abi.encodePacked(computedHash, proofElement)
        );
      } else {
        computedHash = keccak256(
          abi.encodePacked(proofElement, computedHash)
        );
      }

      index = index / 2;
    }
    return computedHash == rootHash;
  }

  function getNextStartBlockNumber() private view returns (uint256) {
    if(bunches.length == 0) return 0;
    return bunches[bunches.length - 1].startBlockNumber + 2**bunches[bunches.length - 1].bunchDepth;
  }




  // / @notice Used to get a number's utf8 representation
  // / @param i Integer
  // / @return utf8 representation of i
  function _getBytesStr(uint i) private pure returns (bytes memory) {
    if (i == 0) {
      return "0";
    }
    uint j = i;
    uint len;
    while (j != 0) {
      len++;
      j /= 10;
    }
    bytes memory bstr = new bytes(len);
    uint k = len - 1;
    while (i != 0) {
      bstr[k--] = byte(uint8(48 + i % 10));
      i /= 10;
    }
    return bstr;
  }
}
