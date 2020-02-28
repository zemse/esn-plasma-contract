// this contract is intended to be deployed on ESN

pragma solidity 0.6.3;

import 'lib/EthParser.sol';
import 'lib/BytesLib.sol';
import 'lib/RLP.sol';
import 'lib/RLPEncode.sol';
import 'lib/MerklePatriciaProof.sol';

contract ReversePlasma {
  using RLP for bytes;
  using RLP for RLP.RLPItem;

  struct BlockHeader {
    bytes32 transactionsRoot;
    bytes32 receiptsRoot;
  }

  uint256 public latestBlockNumber;
  address public token;
  address public depositAddress;
  mapping(address => bool) public isValidator;
  mapping(uint256 => BlockHeader) public ethBlock;

  event NewBlockHeader (
    uint256 blockNumber,
    bytes32 transactionsRoot,
    bytes32 receiptsRoot
  );

  event BytesM(bytes b,string m);
  event Bytes4M(bytes4 b,string m);
  event Bytes32M(bytes32 b,string m);
  event BoolM(bool b,string m);
  event AddressM(address b,string m);
  event UintM(uint b,string m);

  // any validator will be able to add a block
  constructor(address[] memory _validators, address _token) public {
    for(uint256 _i = 0; _i < _validators.length; _i++) {
      isValidator[_validators[_i]] = true;
    }

    token = _token;
  }

  function updateDepositAddress(address _depositAddress) public {
    depositAddress = _depositAddress;
  }

  function submitBlockHeader(bytes memory _blockHeader) public {
    require(isValidator[msg.sender], 'only validator is allowed to submit an eth block');
    uint256 _blockNumber;
    bytes32 _transactionsRoot;
    bytes32 _receiptsRoot;

    assembly {
      let _pointer := add(_blockHeader, 0x20)
      _blockNumber := mload(_pointer)
      _transactionsRoot := mload(add(_pointer, 0x20))
      _receiptsRoot := mload(add(_pointer, 0x40))
    }

    // handle resubmissions

    ethBlock[_blockNumber] = BlockHeader({
      transactionsRoot: _transactionsRoot,
      receiptsRoot: _receiptsRoot
    });

    emit NewBlockHeader(_blockNumber, _transactionsRoot, _receiptsRoot);
  }

  function claimDeposit(bytes memory _rawProof) public {
    RLP.RLPItem[] memory _decodedProof = _rawProof.toRLPItem().toList();

    uint256 _blockNumber = _decodedProof[0].toUint();
    bytes memory _txIndex = _decodedProof[1].toBytes();
    bytes memory _rawTx = _decodedProof[2].toBytes();
    bytes memory _txInBlockProof = _decodedProof[3].toBytes();
    bytes memory _rawReceipt = _decodedProof[4].toBytes();
    bytes memory _receiptInBlockProof = _decodedProof[5].toBytes();

    emit BytesM(_rawTx, 'rawtx');
    emit BytesM(_txIndex, 'txindex');
    emit BytesM(_txInBlockProof, '_txInBlockProof');
    emit Bytes32M(ethBlock[_blockNumber].transactionsRoot, 'ethBlock[_blockNumber].transactionsRoot');

    // bool _out = MerklePatriciaProof.verify(
    //   _rawTx,
    //   _txIndex,
    //   _txInBlockProof,
    //   // _decodedProof[6].toBytes32()
    //   ethBlock[_blockNumber].transactionsRoot
    // );
    // emit BoolM(_out, 'tx');

    require(
      MerklePatriciaProof.verify(
        _rawTx,
        _txIndex,
        _txInBlockProof,
        ethBlock[_blockNumber].transactionsRoot
      )
      , 'Invalid Patricia Tree Transactions proof'
    );

    // bool _out = MerklePatriciaProof.verify(
    //   _rawReceipt,
    //   _txIndex,
    //   _receiptInBlockProof,
    //   ethBlock[_blockNumber].receiptsRoot
    // );
    // emit BoolM(_out, 'receipt');

    require(
      MerklePatriciaProof.verify(
        _rawReceipt,
        _txIndex,
        _receiptInBlockProof,
        ethBlock[_blockNumber].receiptsRoot
      )
      , 'Invalid Patricia Tree Receipts proof'
    );

    bool _status = EthParser.parseReceipt(_rawReceipt);
    require(_status, 'Cannot process deposit for a failed transaction');

    (address _signer, address _erc20Contract, , bytes memory _data) = EthParser.parseTransaction(_rawTx);

    require(
      _erc20Contract == token,
      'transfer should be made to EraSwap ERC20 contract'
    );

    bytes4 _methodSignature;
    address _to;
    uint256 _value;

    assembly {
      let _pointer := add(_data, 0x20)
      _methodSignature := mload(_pointer)
      _to := mload(add(0x4, _pointer))
      _value := mload(add(0x24, _pointer))
    }

    // emit BytesM(_data, 'data');
    // emit Bytes4M(_methodSignature, '_methodSignature');
    // emit AddressM(_to, '_to');
    // emit UintM(_value, '_value');

    require(_methodSignature == hex"a9059cbb", 'transfer method should be there');
    require(_to == depositAddress, 'tokens should be sent to deposit address');

    // payable(_signer).transfer(_value);
  }
}
