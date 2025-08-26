#include "basicpitch.hpp"
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
#include <getopt.h>

using namespace nqr;
using namespace basic_pitch::constants;

static std::vector<float> load_audio_file(std::string filename)
{
    // load a wav file with libnyquist
    std::shared_ptr<AudioData> fileData = std::make_shared<AudioData>();
    NyquistIO loader;
    loader.Load(fileData.get(), filename);

    std::cout << "Input samples: "
              << fileData->samples.size() / fileData->channelCount << std::endl;
    std::cout << "Length in seconds: " << fileData->lengthSeconds << std::endl;
    std::cout << "Number of channels: " << fileData->channelCount << std::endl;

    if (fileData->channelCount != 2 && fileData->channelCount != 1)
    {
        std::cerr
            << "[ERROR] basicpitch.cpp only supports mono and stereo audio"
            << std::endl;
        exit(1);
    }

    // number of samples per channel
    std::size_t N = fileData->samples.size() / fileData->channelCount;

    std::vector<float> mono_audio(N);

    if (fileData->channelCount == 1)
    {
        for (std::size_t i = 0; i < N; ++i)
        {
            mono_audio[i] = fileData->samples[i];
        }
    }
    else
    {
        // Stereo case: downmix to mono
        for (std::size_t i = 0; i < N; ++i)
        {
            mono_audio[i] =
                (fileData->samples[2 * i] + fileData->samples[2 * i + 1]) /
                2.0f;
        }
    }

    // Check if resampling is needed
    if (fileData->sampleRate != SAMPLE_RATE)
    {
        std::cout << "Resampling from " << fileData->sampleRate << " Hz to "
                  << SAMPLE_RATE << " Hz" << std::endl;

        // Resampling using Oboe's resampler module
        aaudio::resampler::MultiChannelResampler *resampler =
            aaudio::resampler::MultiChannelResampler::make(
                1, // Mono (1 channel)
                fileData->sampleRate, SAMPLE_RATE,
                aaudio::resampler::MultiChannelResampler::Quality::Best);

        int numInputFrames =
            N; // Since the audio is mono, numInputFrames is just N
        int numOutputFrames =
            static_cast<int>(static_cast<double>(numInputFrames) * SAMPLE_RATE /
                                 fileData->sampleRate +
                             0.5);

        std::vector<float> resampledAudio(
            numOutputFrames); // Resampled mono audio

        float *inputBuffer = mono_audio.data();
        float *outputBuffer = resampledAudio.data();

        int inputFramesLeft = numInputFrames;
        int numResampledFrames = 0;

        while (inputFramesLeft > 0 && numResampledFrames < numOutputFrames)
        {
            if (resampler->isWriteNeeded())
            {
                resampler->writeNextFrame(inputBuffer);
                inputBuffer++;
                inputFramesLeft--;
            }
            else
            {
                resampler->readNextFrame(outputBuffer);
                outputBuffer++;
                numResampledFrames++;
            }
        }

        while (!resampler->isWriteNeeded() &&
               numResampledFrames < numOutputFrames)
        {
            resampler->readNextFrame(outputBuffer);
            outputBuffer++;
            numResampledFrames++;
        }

        delete resampler;

        return resampledAudio;
    }

    return mono_audio;
}

void print_usage(const char* program_name) {
    std::cout << "Usage: " << program_name << " [OPTIONS] <wav_file> <out_dir>\n"
              << "Options:\n"
              << "  --onset-threshold FLOAT    Onset detection threshold (0.1-1.0, default: 0.5)\n"
              << "  --frame-threshold FLOAT    Frame threshold for note continuation (0.1-1.0, default: 0.3)\n"
              << "  --min-frequency FLOAT      Minimum frequency in Hz (20-100, default: 27.5)\n"
              << "  --max-frequency FLOAT      Maximum frequency in Hz (1000-8000, default: 4186)\n"
              << "  --min-note-length INT      Minimum note length in frames (1-100, default: 11)\n"
              << "  --tempo FLOAT              MIDI tempo in BPM (60-200, default: 120)\n"
              << "  --no-melodia-trick         Disable melodia trick\n"
              << "  --no-pitch-bends           Disable pitch bends\n"
              << "  -h, --help                 Show this help message\n";
}

basic_pitch::BasicPitchConfig parse_arguments(int argc, char* argv[], std::string& wav_file, std::string& out_dir) {
    basic_pitch::BasicPitchConfig config;
    
    static struct option long_options[] = {
        {"onset-threshold", required_argument, 0, 'o'},
        {"frame-threshold", required_argument, 0, 'f'},
        {"min-frequency", required_argument, 0, 'm'},
        {"max-frequency", required_argument, 0, 'M'},
        {"min-note-length", required_argument, 0, 'l'},
        {"tempo", required_argument, 0, 't'},
        {"no-melodia-trick", no_argument, 0, 'n'},
        {"no-pitch-bends", no_argument, 0, 'p'},
        {"help", no_argument, 0, 'h'},
        {0, 0, 0, 0}
    };
    
    int option_index = 0;
    int c;
    
    while ((c = getopt_long(argc, argv, "o:f:m:M:l:t:nph", long_options, &option_index)) != -1) {
        switch (c) {
            case 'o':
                config.onset_threshold = std::stof(optarg);
                if (config.onset_threshold < 0.1f || config.onset_threshold > 1.0f) {
                    std::cerr << "Error: onset-threshold must be between 0.1 and 1.0\n";
                    exit(1);
                }
                break;
            case 'f':
                config.frame_threshold = std::stof(optarg);
                if (config.frame_threshold < 0.1f || config.frame_threshold > 1.0f) {
                    std::cerr << "Error: frame-threshold must be between 0.1 and 1.0\n";
                    exit(1);
                }
                break;
            case 'm':
                config.min_frequency = std::stof(optarg);
                if (config.min_frequency < 20.0f || config.min_frequency > 100.0f) {
                    std::cerr << "Error: min-frequency must be between 20 and 100 Hz\n";
                    exit(1);
                }
                break;
            case 'M':
                config.max_frequency = std::stof(optarg);
                if (config.max_frequency < 1000.0f || config.max_frequency > 8000.0f) {
                    std::cerr << "Error: max-frequency must be between 1000 and 8000 Hz\n";
                    exit(1);
                }
                break;
            case 'l':
                config.min_note_length = std::stoi(optarg);
                if (config.min_note_length < 1 || config.min_note_length > 100) {
                    std::cerr << "Error: min-note-length must be between 1 and 100\n";
                    exit(1);
                }
                break;
            case 't':
                config.tempo_bpm = std::stof(optarg);
                if (config.tempo_bpm < 60.0f || config.tempo_bpm > 200.0f) {
                    std::cerr << "Error: tempo must be between 60 and 200 BPM\n";
                    exit(1);
                }
                break;
            case 'n':
                config.use_melodia_trick = false;
                break;
            case 'p':
                config.include_pitch_bends = false;
                break;
            case 'h':
                print_usage(argv[0]);
                exit(0);
                break;
            case '?':
                print_usage(argv[0]);
                exit(1);
                break;
        }
    }
    
    // Check for required positional arguments
    if (optind + 2 != argc) {
        std::cerr << "Error: Missing required arguments <wav_file> and <out_dir>\n";
        print_usage(argv[0]);
        exit(1);
    }
    
    wav_file = argv[optind];
    out_dir = argv[optind + 1];
    
    return config;
}

int main(int argc, char **argv)
{
    std::string wav_file, out_dir;
    basic_pitch::BasicPitchConfig config = parse_arguments(argc, argv, wav_file, out_dir);

    std::cout << "basicpitch.cpp Main driver program" << std::endl;
    std::cout << "Configuration:" << std::endl;
    std::cout << "  Onset threshold: " << config.onset_threshold << std::endl;
    std::cout << "  Frame threshold: " << config.frame_threshold << std::endl;
    std::cout << "  Min frequency: " << config.min_frequency << " Hz" << std::endl;
    std::cout << "  Max frequency: " << config.max_frequency << " Hz" << std::endl;
    std::cout << "  Min note length: " << config.min_note_length << " frames" << std::endl;
    std::cout << "  Tempo: " << config.tempo_bpm << " BPM" << std::endl;
    std::cout << "  Melodia trick: " << (config.use_melodia_trick ? "enabled" : "disabled") << std::endl;
    std::cout << "  Pitch bends: " << (config.include_pitch_bends ? "enabled" : "disabled") << std::endl;

    // Check if the output directory exists, and create it if not
    std::filesystem::path output_dir_path(out_dir);
    if (!std::filesystem::exists(output_dir_path))
    {
        std::cerr << "Directory does not exist: " << out_dir << ". Creating it."
                  << std::endl;
        if (!std::filesystem::create_directories(output_dir_path))
        {
            std::cerr << "Error: Unable to create directory: " << out_dir
                      << std::endl;
            return 1;
        }
    }
    else if (!std::filesystem::is_directory(output_dir_path))
    {
        std::cerr << "Error: " << out_dir << " exists but is not a directory!"
                  << std::endl;
        return 1;
    }

    std::cout << "Predicting MIDI for: " << wav_file << std::endl;

    std::vector<float> audio = load_audio_file(wav_file);

    auto inference_result = basic_pitch::ort_inference(audio);

    Eigen::Tensor2dXf unwrapped_notes = inference_result.notes;
    Eigen::Tensor2dXf unwrapped_onsets = inference_result.onsets;
    Eigen::Tensor2dXf unwrapped_contours = inference_result.contours;

    // Call the function to convert the output to MIDI
    std::vector<uint8_t> midiBytes =
        basic_pitch::convert_to_midi(inference_result, config);

    // Log the size of the MIDI data
    std::ostringstream log_message;
    log_message << "MIDI data size: " << midiBytes.size();

    std::cout << log_message.str() << std::endl;

    // write the midiBytes to a file 'output.mid' in the output directory
    // we dont need to use libremidi itself since the bytes are already correct
    // just write the bytes to a file

    // Generate MIDI output file name with .mid extension
    std::filesystem::path midi_file =
        output_dir_path / std::filesystem::path(wav_file).filename();
    midi_file.replace_extension(".mid");

    std::ofstream midi_stream(midi_file, std::ios::binary);
    midi_stream.write(reinterpret_cast<const char *>(midiBytes.data()),
                      midiBytes.size());

    std::cout << "Wrote MIDI file to: " << midi_file << std::endl;

    return 0;
}
