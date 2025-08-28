// Initialize parameter controls
function initializeParameterControls() {
    const sliders = [
        'onsetThreshold', 'frameThreshold', 'minFrequency', 
        'maxFrequency', 'minNoteLength', 'tempoBpm'
    ];
    
    sliders.forEach(sliderId => {
        const slider = document.getElementById(sliderId);
        const valueSpan = document.getElementById(sliderId + 'Value');
        
        if (slider && valueSpan) {
            slider.addEventListener('input', function() {
                valueSpan.textContent = this.value;
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeParameterControls);

const SAMPLE_RATE = 22050;
let audioContext;

document.addEventListener('click', function() {
    const context = getAudioContext();
    if (context.state === 'suspended') {
        context.resume();
    }
});

function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate: SAMPLE_RATE});
    }
    return audioContext;
}

const worker = new Worker('worker.js');

const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const fileInfo = document.getElementById('fileInfo');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const status = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');

function showStatus(message, type = 'info') {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
}

function hideStatus() {
    status.style.display = 'none';
}

function showProgress() {
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
}

function updateProgress(percent) {
    progressFill.style.width = `${percent}%`;
}

function hideProgress() {
    progressContainer.style.display = 'none';
}

function showFileInfo(file) {
    fileInfo.innerHTML = `
        <strong>Selected file:</strong> ${file.name}<br>
        <strong>Size:</strong> ${(file.size / 1024 / 1024).toFixed(2)} MB<br>
        <strong>Type:</strong> ${file.type}
    `;
    fileInfo.style.display = 'block';
}

let wasmReady = false;
let pendingAudio = null;

worker.onmessage = function(e) {
    const data = e.data;
    if (data.msg === 'WASM_READY') {
        wasmReady = true;
        if (pendingAudio) {
            sendToWorker(pendingAudio.monoAudio, pendingAudio.config);
            pendingAudio = null;
        }
        return;
    }

    if (data.msg === 'PROCESSING_DONE') {
        updateProgress(90);
        showStatus('Creating MIDI file...', 'info');
        const midiBlob = data.blob;
        const blobUrl = URL.createObjectURL(midiBlob);
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = 'output.mid';
            link.click();
        };
        updateProgress(100);
        hideProgress();
        showStatus('MIDI file generated successfully!', 'success');
        downloadBtn.style.display = 'inline-block';
        console.log('MIDI processing complete');
    } else if (data.msg === 'PROCESSING_FAILED') {
        hideProgress();
        showStatus('WASM processing failed. Please try again.', 'error');
        console.error('WASM processing failed');
    }
};

function processAudio(audioBuffer) {
    if (!audioBuffer) {
        showStatus('No audio buffer available', 'error');
        return;
    }

    const monoAudio = audioBuffer.getChannelData(0);

    const config = {
        onset_threshold: parseFloat(document.getElementById('onsetThreshold')?.value || '0.5'),
        frame_threshold: parseFloat(document.getElementById('frameThreshold')?.value || '0.3'),
        min_frequency: parseFloat(document.getElementById('minFrequency')?.value || '27.5'),
        max_frequency: parseFloat(document.getElementById('maxFrequency')?.value || '4186.0'),
        min_note_length: parseFloat(document.getElementById('minNoteLength')?.value || '0.127'),
        tempo_bpm: parseFloat(document.getElementById('tempoBpm')?.value || '120.0'),
        use_melodia_trick: document.getElementById('useMelodiaTrick')?.checked ?? true,
        include_pitch_bends: document.getElementById('includePitchBends')?.checked ?? true
    };

    console.log('Processing with configuration:', config);

    showStatus('Starting audio processing...', 'processing');
    showProgress();

    if (!wasmReady) {
        pendingAudio = { monoAudio, config };
        worker.postMessage({ msg: 'LOAD_WASM', scriptName: 'basicpitch.js' });
        showStatus('Loading WASM module...', 'info');
        return;
    }

    sendToWorker(monoAudio, config);
}

function sendToWorker(monoAudio, config) {
    worker.postMessage({
        msg: 'PROCESS_AUDIO',
        audioData: monoAudio,
        length: monoAudio.length,
        config: config
    });
}

fileInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) return;
    showFileInfo(file);
    hideStatus();
    downloadBtn.style.display = 'none';

    const reader = new FileReader();
    reader.onload = function(e) {
        const arrayBuffer = e.target.result;
        getAudioContext().decodeAudioData(arrayBuffer, function(audioBuffer) {
            processAudio(audioBuffer);
        }, function(error) {
            showStatus('Error decoding audio file', 'error');
            console.error(error);
        });
    };
    reader.readAsArrayBuffer(file);
});

// Drag & drop handlers
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', e => { e.preventDefault(); uploadArea.classList.remove('dragover'); });
uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (!files.length) return;
    const file = files[0];
    if (!file.type.startsWith('audio/')) {
        showStatus('Please select an audio file.', 'error');
        return;
    }
    fileInput.files = files;
    showFileInfo(file);
    hideStatus();
    downloadBtn.style.display = 'none';

    const reader = new FileReader();
    reader.onload = function(e) {
        const arrayBuffer = e.target.result;
        getAudioContext().decodeAudioData(arrayBuffer, audioBuffer => {
            processAudio(audioBuffer);
        }, error => {
            showStatus('Error decoding audio file', 'error');
            console.error(error);
        });
    };
    reader.readAsArrayBuffer(file);
});
