#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <emscripten.h>
#include <iostream>
#include <libremidi/libremidi.hpp>
#include <libremidi/writer.hpp>
#include <map>
#include <numeric>
#include <ranges>
#include <sstream>
#include <tuple>
#include <vector>

#include "basicpitch.hpp"

extern "C"
{

    // Define a JavaScript function using EM_JS to log for debugging
    EM_JS(void, callWriteWasmLog, (const char *str),
          {console.log(UTF8ToString(str))});

    EMSCRIPTEN_KEEPALIVE
    void convertToMidi(const float *mono_audio, int length,
                       uint8_t **midi_data_ptr, int *midi_size,
                       float onset_threshold, float frame_threshold,
                       float min_frequency, float max_frequency, 
                       float min_note_length, float tempo_bpm,
                       int use_melodia_trick, int include_pitch_bends)
    {
        callWriteWasmLog("Starting inference...");

        // Create configuration object with provided parameters
        basic_pitch::BasicPitchConfig config;
        config.onset_threshold = onset_threshold;
        config.frame_threshold = frame_threshold;
        config.min_frequency = min_frequency;
        config.max_frequency = max_frequency;
        config.min_note_length = min_note_length;
        config.tempo_bpm = tempo_bpm;
        config.use_melodia_trick = (use_melodia_trick != 0);
        config.include_pitch_bends = (include_pitch_bends != 0);
        
        // Log the configuration being used
        std::ostringstream config_log;
        config_log << "Configuration: onset=" << config.onset_threshold 
                   << " frame=" << config.frame_threshold
                   << " freq=" << config.min_frequency << "-" << config.max_frequency
                   << " tempo=" << config.tempo_bpm
                   << " melodia=" << (config.use_melodia_trick ? "on" : "off")
                   << " bends=" << (config.include_pitch_bends ? "on" : "off");
        callWriteWasmLog(config_log.str().c_str());

        auto inference_result = basic_pitch::ort_inference(mono_audio, length);

        callWriteWasmLog("Inference finished. Now generating MIDI file...");

        // Call the function to convert the output to MIDI with configuration
        std::vector<uint8_t> midiBytes =
            basic_pitch::convert_to_midi(inference_result, config);

        callWriteWasmLog("MIDI file generated. Now saving to blob...");

        // Log the size of the MIDI data
        std::ostringstream log_message;
        log_message << "MIDI data size: " << midiBytes.size();
        callWriteWasmLog(log_message.str().c_str());

        // Allocate memory in WASM for the MIDI data and copy the contents
        *midi_size = midiBytes.size();
        *midi_data_ptr = (uint8_t *)malloc(*midi_size);
        if (*midi_data_ptr == nullptr)
        {
            callWriteWasmLog("Failed to allocate memory for MIDI data.");

            // error occurred, set the output pointers to nullptr
            *midi_data_ptr = nullptr;
            *midi_size = 0;
            return;
        }

        // Copy the MIDI data into the allocated memory
        memcpy(*midi_data_ptr, midiBytes.data(), *midi_size);
        
        callWriteWasmLog("MIDI data copied to WASM memory successfully.");
    }
}
