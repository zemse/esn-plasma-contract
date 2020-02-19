pragma solidity 0.6.2;

import 'RLP.sol';

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
  mapping(address => bool) public validatorMapping;
  address[] public validators;
  address[] public signers;
  BunchHeader[] public bunches;

  bytes constant PERSONAL_PREFIX = "\x19Ethereum Signed Message:\n";

  bytes public zemse;

  event Bytes32(bytes32 _bytes32);
  event Address(address _address);
  event NewBunchHeader(
    uint256 _startBlockNumber,
    uint256 _bunchDepth,
    uint256 _bunchIndex
  );

  constructor(address[] memory _validators) public {
    for(uint256 _i = 0; _i < _validators.length; _i++) {
      validatorMapping[_validators[_i]] = true;
    }
    numberOfValidators = _validators.length;
    validators = _validators;
  }

  function getAllValidators() public view returns (address[] memory) {
    return validators;
  }

  function getAllSigners() public view returns (address[] memory) {
    return signers;
  }

  function submitBunchHeader(bytes memory _signedHeader) public returns (address[] memory) {
    RLP.RLPItem[] memory _fullList = _signedHeader.toRlpItem().toList();

    RLP.RLPItem[] memory _headerArray = _fullList[0].toList();

    require(_headerArray.length == 4, 'bunch header must have 4 members');

    bytes memory _transactionsMegaRoot = _headerArray[2].toBytes();
    bytes memory _receiptsMegaRoot = _headerArray[3].toBytes();

    require(_transactionsMegaRoot.length == 32, 'transaction root must have 32 bytes');
    require(_receiptsMegaRoot.length == 32 || _receiptsMegaRoot.length == 0, 'receipt root must have 32 bytes or empty');

    BunchHeader memory _bunchHeader = BunchHeader({
      startBlockNumber: _headerArray[0].toUint(),
      bunchDepth: _headerArray[1].toUint(),
      transactionsMegaRoot: bytesMemoryToBytes32(_transactionsMegaRoot),
      receiptsMegaRoot: bytesMemoryToBytes32(_receiptsMegaRoot)
    });

    require(_bunchHeader.startBlockNumber == getNextStartBlockNumber(), 'invalid start block number');

    bytes memory _headerRlp = _fullList[0].toRlpBytes();

    bytes32 _digest = keccak256(
      abi.encodePacked(
        PERSONAL_PREFIX,
        _getBytesStr(_headerRlp.length),
        _headerRlp
      )
    );

    emit Bytes32(_digest);

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
      emit Address(_signer);
    }

    uint256 _bunchIndex = bunches.length;

    bunches.push(_bunchHeader);

    emit NewBunchHeader(_bunchHeader.startBlockNumber, _bunchHeader.bunchDepth, _bunchIndex);
  }


  function getNextStartBlockNumber() private view returns (uint256) {
    if(bunches.length == 0) return 0;
    return bunches[bunches.length - 1].startBlockNumber + 2**bunches[bunches.length - 1].bunchDepth;
  }

  function bytesMemoryToBytes32(bytes memory _bytes) private pure returns (bytes32 _bytes32) {
    assembly {
      let _pointer := add(_bytes, 0x20)
      _bytes32 := mload(_pointer)
    }
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
