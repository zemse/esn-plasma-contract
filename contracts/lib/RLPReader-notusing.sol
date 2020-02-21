/**
* @title RLPReader
*
* RLPReader is used to read and parse RLP encoded data in memory.
*
* @author Andreas Olofsson (androlo1980@gmail.com)
*/

pragma solidity 0.6.2;

library RLP {

 uint8 constant DATA_SHORT_START = 0x80;
 uint8 constant DATA_LONG_START = 0xB8;
 uint8 constant LIST_SHORT_START = 0xC0;
 uint8 constant LIST_LONG_START = 0xF8;

 uint8 constant DATA_LONG_OFFSET = 0xB7;
 uint8 constant LIST_LONG_OFFSET = 0xF7;
 uint8 constant WORD_SIZE = 32;


 struct RLPItem {
     uint _unsafe_memPtr;    // Pointer to the RLP-encoded bytes.
     uint _unsafe_length;    // Number of bytes. This is the full length of the string.
 }

 struct Iterator {
     RLPItem _unsafe_item;   // Item that's being iterated over.
     uint _unsafe_nextPtr;   // Position of the next item in the list.
 }

 /* Iterator */

 function next(Iterator memory self) internal pure returns (RLPItem memory subItem) {
     if(hasNext(self)) {
         uint ptr = self._unsafe_nextPtr;
         uint itemLength = _itemLength(ptr);
         subItem._unsafe_memPtr = ptr;
         subItem._unsafe_length = itemLength;
         self._unsafe_nextPtr = ptr + itemLength;
     }
     else
         require(false);
 }

 function next(Iterator memory self, bool strict) internal pure returns (RLPItem memory subItem) {
     subItem = next(self);
     if(strict && !_validate(subItem)) require(false);
 }

 function hasNext(Iterator memory self) internal pure returns (bool) {
     RLPItem memory item = self._unsafe_item;
     return self._unsafe_nextPtr < item._unsafe_memPtr + item._unsafe_length;
 }

 /* RLPItem */
 function toRLPItem(bytes memory self) internal pure returns (RLPItem memory) {
     uint len = uint(self.length);
     if (len == 0) {
         return RLPItem(0, 0);
     }
     uint memPtr;
     assembly {
         memPtr := add(self, 0x20)
     }
     return RLPItem(memPtr, len);
 }

 function toRLPBytes(RLPItem memory item) internal pure returns (bytes memory) {
    bytes memory result = new bytes(item._unsafe_length);
    if (result.length == 0) return result;

    uint ptr;
    assembly {
        ptr := add(0x20, result)
    }

    copy(item._unsafe_memPtr, ptr, item._unsafe_memPtr);
    return result;
}

 function toRLPItem(bytes memory self, bool strict) internal pure returns (RLPItem memory) {
     RLPItem memory item = toRLPItem(self);
     if(strict) {
         uint len = uint(self.length);
         if(_payloadOffset(item) > len)
             require(false);
         if(_itemLength(item._unsafe_memPtr) != len)
             require(false);
         if(!_validate(item))
             require(false);
     }
     return item;
 }


 function isNull(RLPItem memory self) internal pure returns (bool ret) {
     return self._unsafe_length == 0;
 }

 function isList(RLPItem memory self) internal pure returns (bool ret) {
     if (self._unsafe_length == 0)
         return false;
     uint memPtr = self._unsafe_memPtr;
     assembly {
         ret := iszero(lt(byte(0, mload(memPtr)), 0xC0))
     }
 }

 function isData(RLPItem memory self) internal pure returns (bool ret) {
     if (self._unsafe_length == 0)
         return false;
     uint memPtr = self._unsafe_memPtr;
     assembly {
         ret := lt(byte(0, mload(memPtr)), 0xC0)
     }
 }

 function isEmpty(RLPItem memory self) internal pure returns (bool ret) {
     if(isNull(self))
         return false;
     uint b0;
     uint memPtr = self._unsafe_memPtr;
     assembly {
         b0 := byte(0, mload(memPtr))
     }
     return (b0 == DATA_SHORT_START || b0 == LIST_SHORT_START);
 }

 function items(RLPItem memory self) internal pure returns (uint) {
     if (!isList(self))
         return 0;
     uint b0;
     uint memPtr = self._unsafe_memPtr;
     assembly {
         b0 := byte(0, mload(memPtr))
     }
     uint pos = memPtr + _payloadOffset(self);
     uint last = memPtr + self._unsafe_length - 1;
     uint itms;
     while(pos <= last) {
         pos += _itemLength(pos);
         itms++;
     }
     return itms;
 }

 function iterator(RLPItem memory self) internal pure returns (Iterator memory it) {
     if (!isList(self))
         require(false);
     uint ptr = self._unsafe_memPtr + _payloadOffset(self);
     it._unsafe_item = self;
     it._unsafe_nextPtr = ptr;
 }

 function toBytes(RLPItem memory self) internal pure returns (bytes memory bts) {
     uint len = self._unsafe_length;
     if (len == 0)
         return "";
     bts = new bytes(len);
     _copyToBytes(self._unsafe_memPtr, bts, len);
 }

 function toData(RLPItem memory self) internal pure returns (bytes memory bts) {
     if(!isData(self))
         require(false);
     (uint rStartPos, uint len) = _decode(self);
     bts = new bytes(len);
     _copyToBytes(rStartPos, bts, len);
 }

 function toList(RLPItem memory self) internal pure returns (RLPItem[] memory list) {
     if(!isList(self))
         require(false);
     uint numItems = items(self);
     list = new RLPItem[](numItems);
     Iterator memory it = iterator(self);
     uint idx;
     while(hasNext(it)) {
         list[idx] = next(it);
         idx++;
     }
 }

 function toAscii(RLPItem memory self) internal pure returns (string memory str) {
     if(!isData(self))
         require(false);
     (uint rStartPos, uint len) = _decode(self);
     bytes memory bts = new bytes(len);
     _copyToBytes(rStartPos, bts, len);
     str = string(bts);
 }

 function toUint(RLPItem memory self) internal pure returns (uint data) {
     if(!isData(self))
         require(false);
     (uint rStartPos, uint len) = _decode(self);
     if (len > 32 || len == 0)
         require(false);
     assembly {
         data := div(mload(rStartPos), exp(256, sub(32, len)))
     }
 }

 function toBool(RLPItem memory self) internal pure returns (bool data) {
     if(!isData(self))
         require(false);
     (uint rStartPos, uint len) = _decode(self);
     if (len != 1)
         require(false);
     uint temp;
     assembly {
         temp := byte(0, mload(rStartPos))
     }
     if (temp > 1)
         require(false);
     return temp == 1 ? true : false;
 }

 function toByte(RLPItem memory self) internal pure returns (byte data) {
     if(!isData(self))
         require(false);
     (uint rStartPos, uint len) = _decode(self);
     if (len != 1)
         require(false);
     uint8 temp;
     assembly {
         temp := byte(0, mload(rStartPos))
     }
     return byte(temp);
 }

 function toInt(RLPItem memory self) internal pure returns (int data) {
     return int(toUint(self));
 }

 function toBytes32(RLPItem memory self) internal pure returns (bytes32 data) {
     return bytes32(toUint(self));
 }

 function toAddress(RLPItem memory self) internal pure returns (address data) {
     if(!isData(self))
         require(false);
     (uint rStartPos, uint len) = _decode(self);
     if (len != 20)
         require(false);
     assembly {
         data := div(mload(rStartPos), exp(256, 12))
     }
 }

 // Get the payload offset.
 function _payloadOffset(RLPItem memory self) private pure returns (uint) {
     if(self._unsafe_length == 0)
         return 0;
     uint b0;
     uint memPtr = self._unsafe_memPtr;
     assembly {
         b0 := byte(0, mload(memPtr))
     }
     if(b0 < DATA_SHORT_START)
         return 0;
     if(b0 < DATA_LONG_START || (b0 >= LIST_SHORT_START && b0 < LIST_LONG_START))
         return 1;
     if(b0 < LIST_SHORT_START)
         return b0 - DATA_LONG_OFFSET + 1;
     return b0 - LIST_LONG_OFFSET + 1;
 }

 // Get the full length of an RLP item.
 function _itemLength(uint memPtr) private pure returns (uint len) {
     uint b0;
     assembly {
         b0 := byte(0, mload(memPtr))
     }
     if (b0 < DATA_SHORT_START)
         len = 1;
     else if (b0 < DATA_LONG_START)
         len = b0 - DATA_SHORT_START + 1;
     else if (b0 < LIST_SHORT_START) {
         assembly {
             let bLen := sub(b0, 0xB7) // bytes length (DATA_LONG_OFFSET)
             let dLen := div(mload(add(memPtr, 1)), exp(256, sub(32, bLen))) // data length
             len := add(1, add(bLen, dLen)) // total length
         }
     }
     else if (b0 < LIST_LONG_START)
         len = b0 - LIST_SHORT_START + 1;
     else {
         assembly {
             let bLen := sub(b0, 0xF7) // bytes length (LIST_LONG_OFFSET)
             let dLen := div(mload(add(memPtr, 1)), exp(256, sub(32, bLen))) // data length
             len := add(1, add(bLen, dLen)) // total length
         }
     }
 }

 // Get start position and length of the data.
 function _decode(RLPItem memory self) private pure returns (uint memPtr, uint len) {
     if(!isData(self))
         require(false);
     uint b0;
     uint start = self._unsafe_memPtr;
     assembly {
         b0 := byte(0, mload(start))
     }
     if (b0 < DATA_SHORT_START) {
         memPtr = start;
         len = 1;
         return (memPtr, len);
     }
     if (b0 < DATA_LONG_START) {
         len = self._unsafe_length - 1;
         memPtr = start + 1;
     } else {
         uint bLen;
         assembly {
             bLen := sub(b0, 0xB7) // DATA_LONG_OFFSET
         }
         len = self._unsafe_length - 1 - bLen;
         memPtr = start + bLen + 1;
     }
     return (memPtr, len);
 }

 // Assumes that enough memory has been allocated to store in target.
 function _copyToBytes(uint btsPtr, bytes memory tgt, uint btsLen) private pure {
     // Exploiting the fact that 'tgt' was the last thing to be allocated,
     // we can write entire words, and just overwrite any excess.
     assembly {
         {
                 let i := 0 // Start at arr + 0x20
                 let words := div(add(btsLen, 31), 32)
                 let rOffset := btsPtr
                 let wOffset := add(tgt, 0x20)

                 for { } eq(i, words) { } {
                   let offset := mul(i, 0x20)
                   mstore(add(wOffset, offset), mload(add(rOffset, offset)))
                   i := add(i, 1)
                 }

                 mstore(add(tgt, add(0x20, mload(tgt))), 0)
         }
     }
 }

 // Check that an RLP item is valid.
     function _validate(RLPItem memory self) private pure returns (bool ret) {
         // Check that RLP is well-formed.
         uint b0;
         uint b1;
         uint memPtr = self._unsafe_memPtr;
         assembly {
             b0 := byte(0, mload(memPtr))
             b1 := byte(1, mload(memPtr))
         }
         if(b0 == DATA_SHORT_START + 1 && b1 < DATA_SHORT_START)
             return false;
         return true;
     }

     function copy(uint src, uint dest, uint len) private pure {
        if (len == 0) return;

        // copy as many word sizes as possible
        for (; len >= WORD_SIZE; len -= WORD_SIZE) {
            assembly {
                mstore(dest, mload(src))
            }

            src += WORD_SIZE;
            dest += WORD_SIZE;
        }

        // left over bytes. Mask is used to remove unwanted bytes from the word
        uint mask = 256 ** (WORD_SIZE - len) - 1;
        assembly {
            let srcpart := and(mload(src), not(mask)) // zero out src
            let destpart := and(mload(dest), mask) // retrieve the bytes
            mstore(dest, or(destpart, srcpart))
        }
    }
}
