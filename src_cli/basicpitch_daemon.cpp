#include "basicpitch.hpp"
#include "model.ort.h"
#include "MultiChannelResampler.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <libnyquist/Common.h>
#include <libnyquist/Decoders.h>
#include <libnyquist/Encoders.h>
#include <map>
#include <numeric>
#include <ranges>
#include <sstream>
#include <stddef.h>
#include <tuple>
#include <vector>
#include <thread>
#include <chrono>
#include <iomanip>  // for std::quoted

using namespace nqr;
using namespace basic_pitch::constants;

// Global ONNX Runtime components for reuse
Ort::Env* g_env = nullptr;
Ort::Session* g_session = nullptr;
bool model_loaded = false;

// Forward declarations
static std::vector<float> load_audio_file(std::string filename);
bool initialize_model();
void cleanup_model();
bool process_audio_file(const std::string& wav_file, const std::string& out_dir, const basic_pitch::BasicPitchConfig& config = basic_pitch::BasicPitchConfig{});

bool initialize_model() {
    try {
        // Initialize ONNX Runtime environment with ERROR level to suppress schema warnings
        g_env = new Ort::Env(ORT_LOGGING_LEVEL_ERROR, "basic_pitch");
        
        // Set session options (use defaults)
        Ort::SessionOptions session_options;
        
        // Create the ONNX Runtime session from the in-memory ORT model
        g_session = new Ort::Session(*g_env, model_ort_start, model_ort_size, session_options);
        
        model_loaded = true;
        std::cout << "Model loaded successfully" << std::endl;
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Error loading model: " << e.what() << std::endl;
        return false;
    }
}

void cleanup_model() {
    if (g_session) {
        delete g_session;
        g_session = nullptr;
    }
    if (g_env) {
        delete g_env;
        g_env = nullptr;
    }
    model_loaded = false;
}

bool process_audio_file(const std::string& wav_file, const std::string& out_dir, const basic_pitch::BasicPitchConfig& config) {
    if (!model_loaded) {
        std::cerr << "Model not loaded!" << std::endl;
        return false;
    }
    
    try {
        // Check if the output directory exists, and create it if not
        std::filesystem::path output_dir_path(out_dir);
        if (!std::filesystem::exists(output_dir_path)) {
            if (!std::filesystem::create_directories(output_dir_path)) {
                std::cerr << "Error: Unable to create directory: " << out_dir << std::endl;
                return false;
            }
        }
        
        std::cout << "Processing: " << wav_file << std::endl;
        
        std::vector<float> audio = load_audio_file(wav_file);
        
        // Use the global session for inference
        auto inference_result = basic_pitch::ort_inference_with_session(*g_session, audio);
        
        // Convert to MIDI
        std::vector<uint8_t> midiBytes = basic_pitch::convert_to_midi(inference_result, config);
        
        // Generate MIDI output file name with .mid extension
        std::filesystem::path midi_file = output_dir_path / std::filesystem::path(wav_file).filename();
        midi_file.replace_extension(".mid");
        
        std::ofstream midi_stream(midi_file, std::ios::binary);
        midi_stream.write(reinterpret_cast<const char*>(midiBytes.data()), midiBytes.size());
        
        std::cout << "SUCCESS: " << midi_file << " (" << midiBytes.size() << " bytes)" << std::endl;
        return true;
        
    } catch (const std::exception& e) {
        std::cerr << "Error processing " << wav_file << ": " << e.what() << std::endl;
        return false;
    }
}

int main(int argc, const char **argv) {
    if (argc < 2) {
        std::cerr << "Usage:" << std::endl;
        std::cerr << "  Single file: " << argv[0] << " <wav file> <out dir>" << std::endl;
        std::cerr << "  Daemon mode: " << argv[0] << " --daemon <out dir>" << std::endl;
        exit(1);
    }
    
    // Check for daemon mode
    if (argc == 3 && std::string(argv[1]) == "--daemon") {
        std::string out_dir = argv[2];
        
        std::cout << "Starting BasicPitch daemon mode..." << std::endl;
        std::cout << "Output directory: " << out_dir << std::endl;
        
        // Initialize model once
        if (!initialize_model()) {
            std::cerr << "Failed to load model" << std::endl;
            return 1;
        }
        
        std::cout << "Ready for commands. Type 'quit' to exit." << std::endl;
        std::cout << "Commands:" << std::endl;
        std::cout << "  process <input_file_path> <output_directory>" << std::endl;
        std::cout << "  quit" << std::endl;
        
        std::string line;
        while (true) {
        if (!std::cin.good()) {
            // stdin closed, bail out cleanly
            std::cout << "Shutting down (stdin closed)..." << std::endl;
            break;
        }

        if (std::cin.peek() == EOF) {
            // no input yet, just sleep briefly
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            continue;
        }

        std::getline(std::cin, line);

        // Trim whitespace
        line.erase(0, line.find_first_not_of(" \t\r\n"));
        line.erase(line.find_last_not_of(" \t\r\n") + 1);

        if (line.empty()) continue;

        if (line == "quit" || line == "exit") {
            std::cout << "Shutting down..." << std::endl;
            break;
        }

        if (line.substr(0, 7) == "process") {
            if (line.length() > 8) {
                std::string args = line.substr(8);
                std::istringstream iss(args);

                std::string input_file;
                std::string output_dir;

                if (!(iss >> std::quoted(input_file))) {
                    std::cout << "ERROR: Missing input file" << std::endl;
                    continue;
                }
                if (!(iss >> std::quoted(output_dir))) {
                    // fallback to daemon's default
                    output_dir = out_dir;
                }

                if (process_audio_file(input_file, output_dir)) {
                    std::cout << "READY" << std::endl;
                } else {
                    std::cout << "ERROR" << std::endl;
                }
            } else {
                std::cout << "ERROR: No file path provided" << std::endl;
            }
        } else {
            std::cout << "ERROR: Unknown command: " << line << std::endl;
        }
    }
        
        cleanup_model();
        return 0;
    }
    
    // Original single-file mode
    if (argc != 3) {
        std::cerr << "Usage: " << argv[0] << " <wav file> <out dir>" << std::endl;
        exit(1);
    }
    
    std::cout << "basicpitch.cpp Main driver program" << std::endl;
    
    std::string wav_file = argv[1];
    std::string out_dir = argv[2];
    
    // Initialize model
    if (!initialize_model()) {
        return 1;
    }
    
    // Process single file
    bool success = process_audio_file(wav_file, out_dir);
    
    cleanup_model();
    
    return success ? 0 : 1;
}

// Include the original load_audio_file function
static std::vector<float> load_audio_file(std::string filename) {
    // [Previous load_audio_file implementation - keeping it the same]
    std::shared_ptr<AudioData> fileData = std::make_shared<AudioData>();
    NyquistIO loader;
    loader.Load(fileData.get(), filename);

    if (fileData->channelCount != 2 && fileData->channelCount != 1) {
        std::cerr << "[ERROR] basicpitch.cpp only supports mono and stereo audio" << std::endl;
        exit(1);
    }

    std::size_t N = fileData->samples.size() / fileData->channelCount;
    std::vector<float> mono_audio(N);

    if (fileData->channelCount == 1) {
        for (std::size_t i = 0; i < N; ++i) {
            mono_audio[i] = fileData->samples[i];
        }
    } else {
        // Stereo case: downmix to mono
        for (std::size_t i = 0; i < N; ++i) {
            mono_audio[i] = (fileData->samples[2 * i] + fileData->samples[2 * i + 1]) / 2.0f;
        }
    }

    // Check if resampling is needed
    if (fileData->sampleRate != SAMPLE_RATE) {
        // [Resampling code - keeping the same as original]
        aaudio::resampler::MultiChannelResampler *resampler =
            aaudio::resampler::MultiChannelResampler::make(
                1, fileData->sampleRate, SAMPLE_RATE,
                aaudio::resampler::MultiChannelResampler::Quality::Best);

        int numInputFrames = N;
        int numOutputFrames = static_cast<int>(static_cast<double>(numInputFrames) * SAMPLE_RATE / fileData->sampleRate + 0.5);
        std::vector<float> resampledAudio(numOutputFrames);

        float *inputBuffer = mono_audio.data();
        float *outputBuffer = resampledAudio.data();
        int inputFramesLeft = numInputFrames;
        int numResampledFrames = 0;

        while (inputFramesLeft > 0 && numResampledFrames < numOutputFrames) {
            if (resampler->isWriteNeeded()) {
                resampler->writeNextFrame(inputBuffer);
                inputBuffer++;
                inputFramesLeft--;
            } else {
                resampler->readNextFrame(outputBuffer);
                outputBuffer++;
                numResampledFrames++;
            }
        }

        while (!resampler->isWriteNeeded() && numResampledFrames < numOutputFrames) {
            resampler->readNextFrame(outputBuffer);
            outputBuffer++;
            numResampledFrames++;
        }

        delete resampler;
        return resampledAudio;
    }

    return mono_audio;
}
