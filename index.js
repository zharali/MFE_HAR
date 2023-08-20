import { encode } from 'cbor'
import { me as companion } from "companion"
import { inbox, outbox } from "file-transfer"
import { localStorage } from "local-storage"
import { settingsStorage } from "settings"
import { ACCEL_SCALAR, statusMsg, valuesPerRecord, headerLength } from '../common/common.js'

//method from https://github.com/gondwanasoft/fitbit-accel-fetcher/blob/main/companion/index.js
//The companion converts the binary data into plain text in CSV format, so it can be read in a text editor or imported into a spreadsheet.
//for now only works for accelerometer 

const httpURL = 'http://127.0.0.1:8000/upload' //http url from the server on the phone (iSH app)
const headerBufferLength = headerLength / 2   // buffer is 16-bit array

let responseTimeoutTimer
let fileNbrPrev
let fileState = {}; //to store the state of each file

//Function to check if a file has already been sent
function isFileSent(fileName) {
  return fileState[fileName] === true;
}

//Function to mark a file as sent
function markFileSent(fileName) {
  fileState[fileName] = true;
}

async function receiveFilesFromWatch(event, fileNbrPrev) {
  console.log('receiveFilesFromWatch()')
  let file
  while ((file = await inbox.pop())) {
    console.log(`Received file ${file.name}`)

    if (file.name === 'obj.cbor') receiveStatusFromWatch(file)
    else receiveDataFromWatch(file, fileNbrPrev)
  }
}

async function receiveDataFromWatch(file, fileNbrPrev) {
  if (isFileSent(file.name)) {
    console.log(`File ${file.name} has already been sent.`);
    return;
  }
  if (file.name.includes("2")) { // start of new sequence of files; reset timestamp variables
    fileNbrPrev = 0
  }
  const data = await file.arrayBuffer()
  // It would be nice to be able to keep the data in memory in case we need to retry sending it, but the companion may be unloaded before we discover the need for this.
  // We could try to save the data using the Storage API.

  // Unpack the binary data here, so we don't have to deal with binary data in the request on the server
  const headerBufferView = new Uint32Array(data)
  let timestamp = headerBufferView[0]
  const dataBufferView = new Int16Array(data)
  const recordCount = (dataBufferView.length - headerBufferLength) / valuesPerRecord   // for accelerometer, four values per record: time, x, y, z

  console.log(`Got file ${file.name}; contents: ${data.byteLength} bytes = ${dataBufferView.length} elements = ${recordCount} records;  timestamp = ${timestamp}`)
  settingsStorage.setItem('fileNbr', file.name)

  const fileNbr = Number(file.name)
  if (fileNbr !== fileNbrPrev + 1) console.log(`File received out of sequence: prev was ${fileNbrPrev}; got ${fileNbr}`)
  fileNbrPrev = fileNbr

  let elementIndex = headerBufferLength    // index into dataBufferView
  let record
  let content = ''  // the body (content) to be sent in the HTTP request
  let timestampDiff
  for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
    //console.log(`${recordIndex} ${dataBufferView[elementIndex]}`)
    timestampDiff = dataBufferView[elementIndex++]  // difference between this timestamp and previous timestamp
    timestamp += timestampDiff
    //console.log(`CHECK here including: ${file.name.includes("accel")}`)
    if (file.name.includes('heartrate')){
      record =  `${timestamp},${dataBufferView[elementIndex++]}\r\n`
    }
    else{
      record = `${timestamp},${dataBufferView[elementIndex++]/ACCEL_SCALAR},${dataBufferView[elementIndex++]/ACCEL_SCALAR},${dataBufferView[elementIndex++]/ACCEL_SCALAR}\r\n` //string
    }
    content += record
  }
  //console.log(`content:\n${content}`)
  sendToServer(content, file.name) //here content is binary --> error
  markFileSent(file.name); // Mark the file as sent
  console.log(`companion received ${file.name}`)
  // Save local variables in case companion is unloaded before next file is received:
  localStorage.setItem('fileNbrPrev', fileNbrPrev)
}

async function receiveStatusFromWatch(file) {
  const status = await file.cbor()
  console.log(`status=${status} (${typeof status})`)
  const statusText = status.status
  console.log(`receiveStatusFromWatch() status=${statusText}`)
  settingsStorage.setItem('fileNbr', `Watch: ${statusText}`)
  sendToServer(JSON.stringify(status), null, true)
}

;(function() {
  companion.wakeInterval = 300000   // encourage companion to wake every 5 minutes
  // Extract persistent global variables from localStorage:
  fileNbrPrev = localStorage.getItem('fileNbrPrev')
  if (fileNbrPrev == null) fileNbrPrev = 0; else fileNbrPrev = Number(fileNbrPrev)
  inbox.addEventListener("newfile", (event) => receiveFilesFromWatch(event, fileNbrPrev))
  receiveFilesFromWatch()
})()


function sendToServer(data, fileName, asJSON) {
  // fileName can be null if sending a status message.
  console.log(`sendToServer() fileName=${fileName} asJSON=${asJSON}`)
  const headers = {}
  if (fileName) {
    headers.FileName = fileName;
    console.log(`FileName header set to ${fileName}`);
  }
  if (asJSON) headers["Content-Type"] = "application/json"
  else headers["Content-Type"] = "text/plain"; // set the Content-Type to text/plain if not JSON
  let fetchInit = {method:'PUT', headers: headers, body:data}
  // To send binary data, use {method:'POST', headers:{"Content-type": "application/octet-stream"}, body:data}
  // timeout in case of no exception or timely response
  responseTimeoutTimer = setTimeout(() => {
    responseTimeoutTimer = undefined
    console.log(`onResponseTimeout()`)
    sendToWatch(fileName, 1, true)   // server response timeout
  }, 5000);

  fetch(httpURL, fetchInit)  
    .then(function(response) {    // promise fulfilled (although server response may not be Ok)
      console.log(`sendToServer() fetch fulfilled: fileName=${fileName}; ok=${response.ok}; status=${response.status}; sText=${response.statusText}`)
      if (responseTimeoutTimer !== undefined) {clearTimeout(responseTimeoutTimer); responseTimeoutTimer = undefined}
      sendToWatch(fileName, response.status)
      if (response.ok) {
        serverResponseOk(fileName, response.statusText)
      } else {
        serverResponseError(response.status, response.statusText)
      }
    }, function(reason) {       // promise rejected (server didn't receive file correctly, or no server because running in simulator)
      console.error(`sendToServer() fetch rejected: ${reason}; fileName=${fileName}. Ensure server is running.`)
      if (responseTimeoutTimer !== undefined) {clearTimeout(responseTimeoutTimer); responseTimeoutTimer = undefined}
      sendToWatch(fileName, 3, true)    // TODO 8 should be 3; set to 200 to allow device and companion testing in sim (ie, without android)
    })
    .catch(function(err) {    // usually because server isn't running
      console.error(`sendToServer() fetch catch: fileName=${fileName}; error: ${err}. Ensure server is running.`)
      if (responseTimeoutTimer) {clearTimeout(responseTimeoutTimer); responseTimeoutTimer = undefined}
      sendToWatch(fileName, 2, true)
    })
  console.error
  console.log(`sendToServer() sent ${fileName}`)
}

function serverResponseOk(fileName, text) {
  console.log(`serverResponseOk(): text=${text}`)
  const statusText = fileName? 'OK' : 'Server: done'
  settingsStorage.setItem('status', statusText)
}

function serverResponseError(status, text) {
 console.error(`serverResponseError(): status=${status} text=${text}`)
 settingsStorage.setItem('status', statusMsg[status])
}

function sendToWatch(fileName, status, updateSettings) {
  if (updateSettings) settingsStorage.setItem('status', statusMsg[status])

  outbox.enqueue('response-'+Date.now(), encode({fileName:fileName, status:status}))
  .then((ft) => {
    console.log(`Transfer of ${ft.name} successfully queued.`);
  })
  .catch((error) => {
    console.error(`Failed to queue response for ${fileName}: ${error}`);
    settingsStorage.setItem('status', "Can't send to watch")
  })
}