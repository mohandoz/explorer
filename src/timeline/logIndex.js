import * as capnp from 'capnp-ts';
import toJSON from '@commaai/capnp-json';
import BufferUtils from 'capnp-split/buffer';
import { Event, Event_Which } from '@commaai/log_reader/capnp/log.capnp';

// IE
if (!Number.MAX_SAFE_INTEGER) {
  Number.MAX_SAFE_INTEGER = Math.pow(2, 53) - 1;
}

export function createIndex (buffer) {
  buffer = Buffer.from(buffer);
  var index = [];

  var calibrations = indexBuffer(index, buffer, 0);

  return {
    index: index,
    buffers: [buffer],
    calibrations: calibrations
  };
}

export function addToIndex (index, newBuff) {
  newBuff = Buffer.from(newBuff);
  index.buffers.push(newBuff);
  var calibrations = indexBuffer(index.index, newBuff, index.buffers.length - 1);
  index.calibrations = index.calibrations.concat(calibrations);

  return index;
}

export function findMonoTime (index, monoTime, start, end) {
  if (start === undefined) {
    start = 0;
  }
  if (end === undefined) {
    end = index.index.length;
  }
  if (start === index.index.length) {
    return index.index.length - 1;
  }
  if (start >= end) {
    return end;
  }
  // index is floored so always increase start
  var curIndex = Math.floor((end - start) / 2 + start);
  var curMillis = index.index[curIndex][0];
  // we can have duplicates so we treat matches as being too high since we're
  // looking for the first instance of a duplicate
  if (curMillis === monoTime) {
    return curIndex;
  }
  if (monoTime < curMillis) {
    return findMonoTime(index, monoTime, start, curIndex);
  }
  if (monoTime > curMillis) {
    return findMonoTime(index, monoTime, curIndex + 1, end);
  }

  // impossible
  return curIndex;
}

function isSafe (monotime) {
  return monotime >= Number.MAX_SAFE_INTEGER;
}

function indexBuffer (index, buffer, bufferIndex) {
  var startNow = performance.now();
  var offset = 0;
  var startIndex = index.length;
  var calibrations = [];
  var lastIndex = index.length ? index.length - 1 : 0;
  // debugger;

  while (offset < buffer.byteLength) {
    let messageBuff = BufferUtils.readMessage(buffer, offset);
    let msg = new capnp.Message(messageBuff, false);
    let event = msg.getRoot(Event);
    let monoTime = event.getLogMonoTime().toString();
    let milis = Number(monoTime.substr(0, monoTime.length - 6));
    let nanos = Number(monoTime.substr(-6, 6));
    let messageSize = messageBuff.byteLength;
    let which = event.which();

    if (which === Event_Which.LIVE_CALIBRATION) {
      calibrations.push(toJSON(event));
    }

    if (!index.length || (milis > index[index.length - 1][0] || (milis === index[index.length - 1][0] && nanos > index[index.length - 1][1]))) {
      index.push([
        milis,
        nanos,
        offset,
        messageSize,
        bufferIndex,
        which
      ]);
      lastIndex = index.length - 1;
    } else {
      let searchIndex = lastIndex;
      let incAmount = 1;
      // debugger;
      while (searchIndex < index.length - 1 && (milis > index[searchIndex][0] || (milis == index[searchIndex][0] && nanos > index[searchIndex][1]))) {
        incAmount = Math.min(Math.floor(index.length - searchIndex / 2), incAmount * 2);
        searchIndex = Math.min(searchIndex + incAmount, index.length - 1);
      }
      // debugger;
      searchIndex = binSearch(index, searchIndex - incAmount, searchIndex, milis, nanos);
      // debugger;
      searchIndex++;
      lastIndex = searchIndex;

      index.splice(searchIndex, 0, [
        milis,
        nanos,
        offset,
        messageSize,
        bufferIndex,
        which
      ]);
    }
    offset += messageSize;
  }

  var endNow = performance.now();
  var timeDiff = (endNow - startNow);

  return calibrations;
}

function binSearch (index, start, end, milis, nanos) {
  if (start >= end) {
    return start;
  }
  let searchIndex = Math.floor((end - start) / 2) + start;
  // searchIndex wont equal end, only start

  if (milis < index[searchIndex][0] || (milis == index[searchIndex][0] && nanos < index[searchIndex][1])) {
    return binSearch(index, start, searchIndex, milis, nanos);
  }
  if (milis > index[searchIndex][0] || (milis == index[searchIndex][0] && nanos > index[searchIndex][1])) {
    if (searchIndex === index.length - 1 || milis < index[searchIndex + 1][0] || (milis == index[searchIndex + 1][0] && nanos < index[searchIndex + 1][1])) {
      return searchIndex;
    }
    return binSearch(index, searchIndex + 1, end, milis, nanos);
  }
  return searchIndex;
}
