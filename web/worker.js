let loadedModule;

onmessage = function(e) {
    if (e.data.msg === 'LOAD_WASM') {
        loadWASMModule(e.data.scriptName);
    } else if (e.data.msg === 'PROCESS_AUDIO') {
        if (!loadedModule) {
            console.error('WASM module not loaded yet');
            postMessage({ msg: 'PROCESSING_FAILED', error: 'WASM module not loaded' });
            return;
        }

        // Convert audio data back from ArrayBuffer
        const inputData = new Float32Array(e.data.audioData);
        const length = e.data.length;

        if (length === 0) {
            console.error('Received empty audio buffer');
            postMessage({ msg: 'PROCESSING_FAILED', error: 'Empty audio buffer' });
            return;
        }

        console.log('Running inference with WASM...');
        console.log('Audio length:', length);
        console.log('Available module properties:', Object.keys(loadedModule));
        console.log('HEAPF32 available:', !!loadedModule.HEAPF32);

        // Allocate memory for audio buffer (16-byte aligned)
        const audioSizeBytes = inputData.length * 4;
        const alignedSize = Math.ceil(audioSizeBytes / 16) * 16;
        const audioPointer = loadedModule._malloc(alignedSize);

        const floatOffset = audioPointer >> 2;
        if (floatOffset + inputData.length > loadedModule.HEAPF32.length) {
            console.error('Insufficient WASM memory for audio data');
            postMessage({ msg: 'PROCESSING_FAILED', error: 'Insufficient WASM memory' });
            loadedModule._free(audioPointer);
            return;
        }

        // Copy audio data into WASM memory
        loadedModule.HEAPF32.set(inputData, floatOffset);

        // Allocate memory for MIDI data pointer and size
        const midiDataPointer = loadedModule._malloc(4);
        const midiSizePointer = loadedModule._malloc(4);

        // Extract configuration or use defaults
        const config = e.data.config || {};
        const onset_threshold = config.onset_threshold ?? 0.5;
        const frame_threshold = config.frame_threshold ?? 0.3;
        const min_frequency = config.min_frequency ?? 27.5;
        const max_frequency = config.max_frequency ?? 4186.0;
        const min_note_length = config.min_note_length ?? 0.127;
        const tempo_bpm = config.tempo_bpm ?? 120.0;
        const use_melodia_trick = config.use_melodia_trick ? 1 : 0;
        const include_pitch_bends = config.include_pitch_bends ? 1 : 0;

        try {
            loadedModule._convertToMidi(
                audioPointer,
                length,
                midiDataPointer,
                midiSizePointer,
                onset_threshold,
                frame_threshold,
                min_frequency,
                max_frequency,
                min_note_length,
                tempo_bpm,
                use_melodia_trick,
                include_pitch_bends
            );
        } catch (error) {
            console.error('Error during WASM inference:', error);
            postMessage({ msg: 'PROCESSING_FAILED', error: error.message });
            loadedModule._free(audioPointer);
            loadedModule._free(midiDataPointer);
            loadedModule._free(midiSizePointer);
            return;
        }

        // Retrieve MIDI data pointer and size
        const midiData = loadedModule.getValue(midiDataPointer, 'i32');
        const midiSize = loadedModule.getValue(midiSizePointer, 'i32');

        if (midiData !== 0 && midiSize > 0) {
            const midiBytes = new Uint8Array(loadedModule.HEAPU8.buffer, midiData, midiSize);
            const blob = new Blob([midiBytes], { type: 'audio/midi' });
            postMessage({ msg: 'PROCESSING_DONE', blob });
            loadedModule._free(midiData);
        } else {
            console.error('Failed to generate MIDI data', { midiData, midiSize });
            postMessage({ msg: 'PROCESSING_FAILED', error: 'Invalid MIDI output' });
        }

        // Free allocated WASM memory
        loadedModule._free(audioPointer);
        loadedModule._free(midiDataPointer);
        loadedModule._free(midiSizePointer);
    }
};

function loadWASMModule(scriptName) {
    importScripts(`${scriptName}?v=${Date.now()}`);
    const modulePromise = libbasicpitch(); // WASM glue code creates this

    modulePromise.then(mod => {
        loadedModule = mod;
        console.log('WASM module loaded:', Object.keys(loadedModule));
        postMessage({ msg: 'WASM_READY' });
    }).catch(err => {
        console.error('Failed to load WASM module', err);
        postMessage({ msg: 'PROCESSING_FAILED', error: 'WASM module load failed' });
    });
}
