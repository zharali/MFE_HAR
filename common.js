export const ACCEL_SCALAR = 500   // up to 6.5g; resolution 0.002 m/s/s, scaling factor to convert raw acceleration readings into units of meters per second squared
export const valuesPerRecord = 4  // x, y, z, time
export const statusMsg = {        // codes<100 are only used from companion to watch; codes>550 are custom HTTP codes sent from android-fitbit-fetcher
  1:"No server resp",
  2:"Server comm error",
  3:"Server comm reject",
  4:"Server response bad",
  200:"OK",
  500:'Server error',
  501:'Not implemented',
  555:'Invalid data',
  556:'Invalid length'
}
export const headerLength = Uint32Array.BYTES_PER_ELEMENT*10 // one Unit32 for fileTimestamp

export const frequency = 100                                    // Hz (records per second): watch may go faster as it rounds intervals down to a multiple of 10ms
export const batchPeriod = 1                             // elapsed time between batches (seconds)
export const recordsPerBatch = frequency * batchPeriod
export const bytesPerRecord = valuesPerRecord * 2              // 2 because values are Int16 (2 bytes) each
export const recDurationPerFile = 60                         // seconds of data that will be stored in each file (assuming frequency is accurate) (default: 60)  // TODO 8 set recDurationPerFile = 60
export const recordsPerFile = frequency * recDurationPerFile   // 1800 for ~15 second BT transfer time at 8 bytes per record; 100 for a new file every few seconds; file may exceed this by up to recordsPerBatch
export const bytesPerBatch = bytesPerRecord * recordsPerBatch
export const headerBuffer = new ArrayBuffer(headerLength)   // holds timestamp of first record in file
export const headerBufferView = {
  timestamp: new Uint32Array(headerBuffer, 0, 1),
  id: new Uint32Array(headerBuffer, 4, 1)
};
export const dataBuffer = new ArrayBuffer(bytesPerBatch)
export const dataBufferView = new Int16Array(dataBuffer)