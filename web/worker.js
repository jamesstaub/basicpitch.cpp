let wasmModule;
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

        const inputData = new Float32Array(e.data.inputData); // Convert back from ArrayBuffer
        const length = e.data.length;  // Use the correct length

        console.log('Running inference with WASM...');
        console.log('length:', length);
        console.log('Available module properties:', Object.keys(loadedModule));
        console.log('HEAPF32 available:', !!loadedModule.HEAPF32);
        console.log('HEAPU8 available:', !!loadedModule.HEAPU8);
        console.log('setValue available:', !!loadedModule.setValue);

        // Allocate memory in WASM and copy input data into the WASM memory
        // Ensure 16-byte alignment for better performance and to avoid alignment faults
        const audioSizeBytes = inputData.length * inputData.BYTES_PER_ELEMENT;
        const alignedSize = Math.ceil(audioSizeBytes / 16) * 16; // Round up to nearest 16-byte boundary
        const audioPointer = loadedModule._malloc(alignedSize);
        
        console.log('Allocated', alignedSize, 'bytes (aligned) for', audioSizeBytes, 'bytes of audio data');
        console.log('Audio pointer:', audioPointer, 'is aligned:', (audioPointer % 16 === 0));
        
        // Now that we should have HEAPF32 available, use it directly
        if (loadedModule.HEAPF32) {
            console.log('Using HEAPF32 for memory access');
            console.log('Audio pointer:', audioPointer, 'Audio size in bytes:', inputData.length * 4);
            console.log('HEAPF32 buffer size:', loadedModule.HEAPF32.buffer.byteLength);
            
            // Make sure the pointer is properly aligned for float access (divisible by 4)
            const floatOffset = audioPointer >> 2; // Divide by 4 to get float index
            console.log('Float offset:', floatOffset, 'Input length:', inputData.length);
            console.log('Required end position:', floatOffset + inputData.length);
            console.log('HEAPF32 length:', loadedModule.HEAPF32.length);
            
            // Check if we have enough space
            if (floatOffset + inputData.length > loadedModule.HEAPF32.length) {
                console.error('Not enough WASM memory allocated');
                console.error('Required:', floatOffset + inputData.length, 'Available:', loadedModule.HEAPF32.length);
                postMessage({ msg: 'PROCESSING_FAILED', error: 'Insufficient WASM memory' });
                return;
            }
            
            // Copy data using subarray to avoid buffer alignment issues
            const wasmView = loadedModule.HEAPF32.subarray(floatOffset, floatOffset + inputData.length);
            wasmView.set(inputData);
            console.log('Audio data copied successfully');
        } else {
            console.error('HEAPF32 still not available!');
            postMessage({ msg: 'PROCESSING_FAILED', error: 'HEAPF32 not available' });
            return;
        }

        // Allocate memory for MIDI data pointer and size
        const midiDataPointer = loadedModule._malloc(4);  // Allocate 4 bytes for the pointer (uint8_t*)
        const midiSizePointer = loadedModule._malloc(4);  // Allocate 4 bytes for the size (int)

        // Call the WASM function with the audio buffer, length, and pointers for the MIDI data and size
        try {
            console.log('Calling _convertToMidi with audio data...');
            loadedModule._convertToMidi(audioPointer, length, midiDataPointer, midiSizePointer);
            console.log('_convertToMidi completed successfully');
        } catch (error) {
            console.error('Error during WASM inference:', error);
            postMessage({ msg: 'PROCESSING_FAILED', error: 'WASM inference failed: ' + error.message });
            // Clean up allocated memory
            loadedModule._free(audioPointer);
            loadedModule._free(midiDataPointer);
            loadedModule._free(midiSizePointer);
            return;
        }

        // Retrieve the MIDI data pointer and size from WASM memory
        const midiData = loadedModule.getValue(midiDataPointer, 'i32');  // Get the pointer to MIDI data
        const midiSize = loadedModule.getValue(midiSizePointer, 'i32'); // Get the size of the MIDI data

        // If valid MIDI data was returned
        if (midiData !== 0 && midiSize > 0) {
            // Access the MIDI data from WASM memory using HEAPU8
            const midiBytes = new Uint8Array(midiSize);
            if (loadedModule.HEAPU8) {
                const sourceBytes = new Uint8Array(loadedModule.HEAPU8.buffer, midiData, midiSize);
                midiBytes.set(sourceBytes);
            } else {
                console.error('HEAPU8 not available for MIDI data');
                postMessage({ msg: 'PROCESSING_FAILED', error: 'HEAPU8 not available' });
                return;
            }

            console.log('MIDI data extracted:', midiSize, 'bytes');
            console.log('First 16 bytes:', Array.from(midiBytes.slice(0, 16), b => b.toString(16).padStart(2, '0')).join(' '));

            // Create a Blob from the MIDI data
            const blob = new Blob([midiBytes], { type: 'audio/midi' });

            // Optionally, create a URL from the Blob
            const blobUrl = URL.createObjectURL(blob);

            // Send the Blob (or the Blob URL) back to the main thread
            postMessage({
                msg: 'PROCESSING_DONE',
                blob: blob,  // Send the Blob directly
                blobUrl: blobUrl // Alternatively, send the Blob URL
            });

            // Free the memory allocated for the MIDI data in WASM
            loadedModule._free(midiData);
        } else {
            console.error('Failed to generate MIDI data.');
            console.log('midiData:', midiData);
            console.log('midiSize:', midiSize);
            postMessage({ msg: 'PROCESSING_FAILED' });
        }

        // Free the memory allocated in WASM for the input audio and the MIDI pointer/size
        loadedModule._free(audioPointer);
        loadedModule._free(midiDataPointer);
        loadedModule._free(midiSizePointer);
    }
};

function loadWASMModule(scriptName) {
    //importScripts(scriptName);  // Load the WASM glue code
    //<script src="basicpitch.js?v=<?= time() ?>"></script>
    importScripts(`${scriptName}?v=${new Date().getTime()}`);  // Load the WASM glue code w/ cache busting

    // Initialize the WASM module (which should set `Module`)
    wasmModule = libbasicpitch(); // Module is created in the glue code

    wasmModule.then((loaded_module) => {
        console.log('WASM module loaded:', loaded_module);
        console.log('Available properties:', Object.keys(loaded_module));
        console.log('HEAPF32 available:', !!loaded_module.HEAPF32);
        console.log('HEAP8 available:', !!loaded_module.HEAP8);
        console.log('HEAPU8 available:', !!loaded_module.HEAPU8);

        postMessage({ msg: 'WASM_READY' });

        loadedModule = loaded_module;
    });
}
