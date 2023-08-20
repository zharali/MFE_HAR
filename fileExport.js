import { display } from "display"
import { outbox } from 'file-transfer'
import document from "document";

const statusEl = document.getElementById('status')
const errorEl = document.getElementById('error') 

let state = {fileNumberRecording: undefined}

export function sendFile(fileName, fileNumberSending, fileNumberRecording) {

    console.log('filename:' + fileName)
    const operation = fileName? 'Res' : 'S'   // plus 'ending...'
    if (!fileName) fileName = fileNumberSending
  
    outbox
      .enqueueFile("/private/data/"+fileName)
      .then(ft => {
        statusEl.text = operation + 'ending file ' + fileName + ' of ' + state.fileNumberRecording + '...'
        display.poke()
        console.log(`${operation}ending file ${fileName} of ${state.fileNumberRecording}: queued`);
      })
      .catch(err => {
        console.error(`Failed to queue transfer of ${fileName}: ${err}`);
        errorEl.text = "Can't send " + fileName + " to companion"
        display.poke()
      })
  }