#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function bytesToHex(bytes, maxBytes = 512) {
    const displayBytes = bytes.slice(0, maxBytes);
    let output = '';
    
    for (let i = 0; i < displayBytes.length; i += 16) {
        const offset = i.toString(16).padStart(8, '0');
        const chunk = displayBytes.slice(i, i + 16);
        const hex = Array.from(chunk, byte => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
        const ascii = Array.from(chunk, byte => 
            byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'
        ).join('');
        output += `${offset}: ${hex} |${ascii}|\n`;
    }
    
    if (bytes.length > maxBytes) {
        output += `\n... (showing first ${maxBytes} of ${bytes.length} bytes)\n`;
    }
    
    return output;
}

function parseMIDIHeader(data) {
    if (data.length < 14) {
        throw new Error('File too small to be a valid MIDI file');
    }
    
    const header = {};
    
    // Check for MThd header
    const headerChunk = data.slice(0, 4).toString('ascii');
    if (headerChunk !== 'MThd') {
        throw new Error(`Invalid MIDI header. Expected 'MThd', got '${headerChunk}'`);
    }
    
    header.headerChunk = headerChunk;
    header.headerLength = data.readUInt32BE(4);
    header.format = data.readUInt16BE(8);
    header.numTracks = data.readUInt16BE(10);
    header.division = data.readUInt16BE(12);
    
    // Parse division
    if (header.division & 0x8000) {
        // SMPTE format
        const smpteFormat = (header.division >> 8) & 0x7F;
        const ticksPerFrame = header.division & 0xFF;
        header.timingFormat = 'SMPTE';
        header.smpteFormat = smpteFormat;
        header.ticksPerFrame = ticksPerFrame;
    } else {
        // Ticks per quarter note
        header.timingFormat = 'Ticks per quarter note';
        header.ticksPerQuarterNote = header.division;
    }
    
    return header;
}

function findTracks(data) {
    const tracks = [];
    let offset = 14; // Start after header
    
    while (offset < data.length - 8) {
        const trackChunk = data.slice(offset, offset + 4).toString('ascii');
        
        if (trackChunk === 'MTrk') {
            const trackLength = data.readUInt32BE(offset + 4);
            tracks.push({
                offset: offset,
                length: trackLength,
                dataStart: offset + 8,
                dataEnd: offset + 8 + trackLength
            });
            offset += 8 + trackLength;
        } else {
            offset++;
        }
    }
    
    return tracks;
}

function inspectMIDIFile(filename) {
    try {
        if (!fs.existsSync(filename)) {
            console.error(`Error: File '${filename}' not found`);
            return;
        }
        
        const data = fs.readFileSync(filename);
        const fileSize = data.length;
        
        console.log('='.repeat(60));
        console.log(`MIDI File Inspector - ${path.basename(filename)}`);
        console.log('='.repeat(60));
        console.log(`File Size: ${fileSize} bytes`);
        console.log();
        
        try {
            // Parse MIDI header
            const header = parseMIDIHeader(data);
            console.log('✓ Valid MIDI file detected');
            console.log();
            console.log('MIDI Header Information:');
            console.log(`  Header Chunk: ${header.headerChunk}`);
            console.log(`  Header Length: ${header.headerLength} bytes`);
            console.log(`  Format: ${header.format} (${header.format === 0 ? 'Single track' : header.format === 1 ? 'Multiple tracks, synchronous' : 'Multiple tracks, asynchronous'})`);
            console.log(`  Number of Tracks: ${header.numTracks}`);
            console.log(`  Timing Format: ${header.timingFormat}`);
            if (header.ticksPerQuarterNote) {
                console.log(`  Ticks per Quarter Note: ${header.ticksPerQuarterNote}`);
            }
            console.log();
            
            // Find tracks
            const tracks = findTracks(data);
            console.log('Track Information:');
            console.log(`  Tracks Found: ${tracks.length}`);
            tracks.forEach((track, index) => {
                console.log(`  Track ${index + 1}: ${track.length} bytes (offset: ${track.offset})`);
            });
            console.log();
            
            if (tracks.length !== header.numTracks) {
                console.log(`⚠ Warning: Header says ${header.numTracks} tracks, but found ${tracks.length}`);
                console.log();
            }
            
        } catch (error) {
            console.log(`✗ Error parsing MIDI file: ${error.message}`);
            console.log();
        }
        
        // Hex dump
        console.log('Raw Data (First 512 bytes):');
        console.log('-'.repeat(60));
        console.log(bytesToHex(data));
        
    } catch (error) {
        console.error(`Error reading file: ${error.message}`);
    }
}

// Command line usage
if (require.main === module) {
    const filename = process.argv[2];
    if (!filename) {
        console.log('Usage: node midi-inspector.js <midi-file>');
        console.log('Example: node midi-inspector.js output.mid');
        process.exit(1);
    }
    
    inspectMIDIFile(filename);
}

module.exports = { inspectMIDIFile, parseMIDIHeader, findTracks };
