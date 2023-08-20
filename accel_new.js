import { Accelerometer } from "accelerometer";
import { me } from "appbit"
import { display } from "display"
import document from 'document'
import * as fs from "fs"
import { inbox, outbox } from 'file-transfer'
import { ACCEL_SCALAR, statusMsg, frequency, recordsPerBatch, bytesPerRecord, recordsPerFile, headerBuffer, headerBufferView, dataBuffer, dataBufferView } from '../common/common.js'
import { sendFile } from "./fileExport.js";

const accel = new Accelerometer({ frequency: frequency, batch: recordsPerBatch })
const recTimeEl = document.getElementById('recTime') 
const statusEl = document.getElementById('status')
const errorEl = document.getElementById('error') 
const fileName = '';
const state = {
  fileNumberRecording: undefined,
  currentActivity: undefined, // add a new property to store the current activity name
}; 

let fileDescriptor
let isRecording = false
let isTransferring = false
let fileNumberSending
let recordsInFile, recordsRecorded
let startTime
let dateLastBatch   // only used for debug logging
let fileTimestamp   // timestamp of first record in file currently being recorded
let prevTimestamp

me.appTimeoutEnabled = false
accel.addEventListener("reading", onAccelReading)

inbox.addEventListener("newfile", receiveFilesFromCompanion)
receiveFilesFromCompanion()

//check it in the click evt?
export function startAccel(activity) { //checks if the isTransferring flag is set to true or not, and returns immediately if it is true. If disableTouch flag is also true and isRecording flag is true, it returns immediately as well. If isRecording flag is true, it calls stopRec() function to stop recording. If isRecording flag is false, it calls startRec() function to start recording.
  if (isRecording) return
  state.currentActivity = activity;
  if (isRecording) stopRec()
  else startRec(activity);
  console.log("accel recording")
}

export function stopAccel(){
  stopRec();
  console.log("accel stopped")
}

//***** Record data *****s
function openFile() {   // opens a new file corresponding to state.fileNumberRecording and writes fileTimestamp
    // Construct filename with ID number
    const id = state.fileNumberRecording;
    fileName = `accel_${id}_${state.currentActivity}`; // generate filename with id number
    fileDescriptor = fs.openSync(fileName, 'a'); 
    console.log(`Starting new file: ${state.fileNumberRecording} ${fileName}`)
    headerBufferView.timestamp[0] = fileTimestamp;
    headerBufferView.id[0] = id;
  fs.writeSync(fileDescriptor, headerBuffer)
  // Increment file number
  state.fileNumberRecording += 1;
  recordsInFile = 0
  statusEl.text = 'Recording file '+state.fileNumberRecording
  display.poke()
}

function onAccelReading(activity) {
  if (!isRecording) {
    console.error("onAccelReading but not recording")
    return
  }

  const dateNow = Date.now()
  if (dateLastBatch) {
    //console.log(`t since last batch: ${dateNow-dateLastBatch} ms`)  // debugging
  }
  dateLastBatch = dateNow

  // See if we need a new file for this batch:
  const needNewFile = fileDescriptor === undefined || recordsInFile >= recordsPerFile
  if (needNewFile) {
    fileTimestamp = prevTimestamp = accel.readings.timestamp[0]
    console.log(`accel -> needNewFile: fileTimestamp=${fileTimestamp}`);
  }

  // Put the accel readings into dataBuffer:
  const batchSize = accel.readings.timestamp.length
  let bufferIndex = 0, timestamp
  //console.log(`batchSize=${batchSize}`)
  //console.log(`timestamp[]=${accel.readings.timestamp}`)
  for (let index = 0; index<batchSize; index++) {
    //console.log(`${accel.readings.timestamp[index]} ${accel.readings.x[index]}}`)
    timestamp = accel.readings.timestamp[index]
    dataBufferView[bufferIndex++] = timestamp - prevTimestamp // store differential timestamps so they fit in Int16
    prevTimestamp = timestamp

    dataBufferView[bufferIndex++] = accel.readings.x[index] * ACCEL_SCALAR
    dataBufferView[bufferIndex++] = accel.readings.y[index] * ACCEL_SCALAR
    dataBufferView[bufferIndex++] = accel.readings.z[index] * ACCEL_SCALAR
  }

  // Open a new file if necessary:
  if (fileDescriptor === undefined) {   // this is the start of this recording session
    openFile()
  } else {  // a file is already open
    if (recordsInFile >= recordsPerFile) {  // file is full
      startTransferAccel() //send the full file before opening a new one
      fs.closeSync(fileDescriptor)
      recordsRecorded += recordsInFile
      state.fileNumberRecording++
      openFile()
    }
  }

  // Write record batch to file:
  try {
    fs.writeSync(fileDescriptor, dataBuffer, 0, batchSize*bytesPerRecord)
    recordsInFile += batchSize
  } catch(e) {
    console.error("Can't write to file (out of storage space?)")
  }

  recTimeEl.text = Math.round((Date.now()-startTime)/1000)
}

function startRec(activity) {
  dateLastBatch = recordsInFile = recordsRecorded = 0
  recTimeEl.text = '0'
  state.fileNumberRecording = 1
  errorEl.style.fill = '#ff0000'
  errorEl.text = ''
  statusEl.text = 'Recording file ' + state.fileNumberRecording
  accel.start()
  console.log('Started.')
  startTime = Date.now()
  isRecording = true
  onAccelReading(activity);
}

function stopRec() {
  accel.stop()
  fs.closeSync(fileDescriptor)
  fileDescriptor = undefined
  console.log(`stopRec(): fileNumberRecording=${state.fileNumberRecording} recordsInFile=${recordsInFile}`)
  if (!recordsInFile) {   // don't include a zero-length file
    console.error(`Empty file!`)
    fs.unlinkSync(state.fileNumberRecording)
    state.fileNumberRecording--
  }
  recordsRecorded += recordsInFile
  console.log('Stopped.')
  statusEl.text = `Recorded ${state.fileNumberRecording} file(s)`
  const size = recordsRecorded * bytesPerRecord / 1024
  errorEl.style.fill = '#0080ff'
  errorEl.text = `(${recordsRecorded} readings; ${Math.round(size)} kB)`
  display.poke()
  isRecording = false
}

/***** File sending *****/
export function startTransferAccel() {
  console.log(`started file transfer of: ${fileName}`)
  if (!state.fileNumberRecording) return
  isTransferring = true
  errorEl.style.fill = '#ff0000'
  errorEl.text = ''
  recTimeEl.text = ''
  fileNumberSending = 1
  sendFile(fileName, fileNumberSending, state.fileNumberRecording)
}

export function stopTransferAccel() {
  statusEl.text = 'Transfer aborted'
  display.poke()
  errorEl.text = ''
  isTransferring = false
}

function sendObject(obj) {
  fs.writeFileSync("obj.cbor", obj, "cbor")

  outbox
    .enqueueFile("/private/data/obj.cbor")
    .then(ft => {
      console.log(`obj.cbor transfer queued.`);
    })
    .catch(err => {
      console.log(`Failed to schedule transfer of obj.cbor: ${err}`);
      errorEl.text = "Can't send status to companion"
      display.poke()
    })
}

function receiveFilesFromCompanion() {
  let fileName
  while (fileName = inbox.nextFile()) {
    console.log(`receiveFilesFromCompanion(): received ${fileName}`)
    const response = fs.readFileSync(fileName, 'cbor')
    console.log(`watch received response status code ${response.status} (${statusMsg[response.status]}) for file ${response.fileName}`)
    // See /common/common.js for response.status codes.
    if (response.fileName) {
      if (isTransferring) {
        if (response.status === 200) sendNextFile()
        else resendFile(response)
      }
    } else {  // no fileName; must have been a control object
      // should check response.status
      statusEl.text = 'Finished — see phone'
      display.poke()
      isTransferring = false
    }

    fs.unlinkSync(fileName)
  }
}

function sendNextFile() {
  errorEl.text = ''
  if (++fileNumberSending > state.fileNumberRecording) {
    console.log('All files sent okay; waiting for server to acknowledge')
    statusEl.text = 'All data sent; wait...'
    display.poke()
    sendObject({status:'done'})
    return
  }
  sendFile(fileName)
}

function resendFile(response) {
  errorEl.text = `${statusMsg[response.status]} on ${response.fileName}`
  display.poke()
  console.log(`Resending ${response.fileName}`)
  sendFile(response.fileName)
}

me.onunload = () => {
  saveState()
}

function saveState() {
  fs.writeFileSync("state.cbor", state, "cbor")
}