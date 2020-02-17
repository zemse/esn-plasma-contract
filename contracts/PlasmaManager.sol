pragma solidity 0.6.0;

// this contract will store block headers
contract PlasmaManager {
  struct BunchHeader {
    uint256 startBlockNumber;
    uint256 bunchDepth; // number of blocks in bunch is 2^bunchDepth
    bytes32 transactionsMegaRoot;
    // bytes32 receiptsMegaRoot;
    // bytes32 r;
    // bytes32 s;
    // uint8 v;
    uint256 timestamp;
  }

  // mapping(address => bool) public validators;
  address[] public validators;
  address[] public signers;

  constructor(address[] memory _validators) public {
    // for(uint256 _i = 0; _i < _validators.length; _i++) {
    //   validators[_validators[_i]] = true;
    // }
    validators = _validators;
  }

  function getAllValidators() public view returns (address[] memory) {
    return validators;
  }

  function getAllSigners() public view returns (address[] memory) {
    return signers;
  }

  function submitBunchHeader(bytes memory _header, bytes memory _signatures) public returns (address[] memory) {
    bytes32 _startBlockNumber;
    bytes32 _bunchDepth;
    bytes32 _transactionsMegaRoot;
    // bytes32 _receiptsMegaRoot;
    // bytes32[] _sigRArray;
    // bytes32[] _sigSArray;
    // bytes1[] _sigVArray;

    assembly {
      let _pointer := add(_header, 0x20)
      _startBlockNumber := mload(_pointer)
      _bunchDepth := mload(add(_pointer, 32))
      _transactionsMegaRoot := mload(add(_pointer, 64))
    }

    // require(validators.length <= _signatures.length / 66
    //   , 'signature of all validators should be there');



    for(uint256 _i = 0; _i <= validators.length; _i++) {
      // bytes memory _signature = _signatures[_i];

      bytes32 _sigR;
      bytes32 _sigS;
      bytes1 _sigV;

      assembly {
        let _pointer := add(_signatures, 0x20)
        _pointer := add(_pointer, mul(66, _i))
        _sigR := mload(add(_pointer, 32))
        _sigS := mload(add(_pointer, 64))
        _sigV := mload(add(_pointer, 96))
        if lt(_sigV, 27) { _sigV := add(_sigV, 27) }
      }

      // parsedSignatures.push(Signature({
      //   r: _sigR,
      //   s: _sigS,
      //   v: _sigV
      // }));

      address signer = ecrecover(_transactionsMegaRoot, uint8(_sigV), _sigR, _sigS);

      signers.push(signer);
    }

    return signers;

  }

}
