const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const project = path.resolve(__dirname, '..');
const native = ['DownloadSource.swift', 'OfflineAssetValidator.swift', 'DownloadMuxer.swift'].map(name => path.join(project, 'ios/Langform/Langform', name));

function run(command, args, timeout = 60000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('shipping AVFoundation mux preserves complete real tracks, rejects invalid inputs and cleans cancelled work', { skip: process.platform !== 'darwin', timeout: 90000 }, t => {
  const toolchain = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  const encoder = spawnSync('/usr/bin/env', ['ffmpeg', '-version'], { encoding: 'utf8' });
  if (toolchain.status !== 0 || sdk.status !== 0 || encoder.status !== 0) return t.skip('Requires the existing macOS Swift SDK and ffmpeg');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-download-mux-'));
  try {
    const ffmpeg = args => run('/usr/bin/env', ['ffmpeg', '-v', 'error', ...args]);
    const video = path.join(folder, 'video.mp4');
    const audio = path.join(folder, 'audio.m4a');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=15:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-y', video]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'aac', '-vn', '-movflags', '+faststart', '-y', audio]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'aac', '-vn', '-movflags', '+faststart', '-y', path.join(folder, 'long-audio.m4a')]);
    ffmpeg(['-i', video, '-i', audio, '-c', 'copy', '-movflags', '+faststart', '-y', path.join(folder, 'combined.mp4')]);
    ffmpeg(['-display_rotation', '90', '-i', video, '-c', 'copy', '-y', path.join(folder, 'rotated.mp4')]);
    for (const [source, name] of [[video, 'truncated-video.mp4'], [audio, 'truncated-audio.m4a']]) {
      const data = fs.readFileSync(source);
      fs.writeFileSync(path.join(folder, name), data.subarray(0, Math.floor(data.length / 2)));
    }
    const executable = path.join(folder, 'mux-tests');
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    run(toolchain.stdout.trim(), ['-parse-as-library', '-target', architecture + '-apple-macosx26.0', '-sdk', sdk.stdout.trim(), ...native, path.join(project, 'tests/fixtures/DownloadMuxExercise.swift'), '-o', executable]);
    const output = run(executable, [folder]);
    t.diagnostic(output.trim());
    for (const marker of ['REAL_AVFOUNDATION_MUX_AND_PRODUCTION_VALIDATOR_OK', 'REAL_ROTATED_VIDEO_TRANSFORM_PRESERVED_OK', 'WRONG_TRACKS_DURATION_TRUNCATION_SIZE_AND_ATOMIC_DESTINATION_OK', 'REAL_MID_PIPELINE_CANCELLATION_CLEANUP_OK', 'REAL_PARTIAL_EXPORT_CANCELLATION_CLEANUP_OK', 'ORIGINAL_INPUTS_UNCHANGED_OK']) assert.ok(output.includes(marker), output);
    // Independent decoder confirmation supplements the shipping compressed
    // sample validator. Both audio and every video frame must decode cleanly.
    ffmpeg(['-xerror', '-i', path.join(folder, 'joined.mp4'), '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    const probe = name => JSON.parse(run('/usr/bin/env', ['ffprobe', '-v', 'error', '-count_packets', '-show_streams', '-of', 'json', path.join(folder, name)]));
    const originalVideo = probe('video.mp4').streams.find(stream => stream.codec_type === 'video');
    const originalAudio = probe('audio.m4a').streams.find(stream => stream.codec_type === 'audio');
    const joined = probe('joined.mp4');
    assert.equal(joined.streams.length, 2);
    const packets = (name, type) => JSON.parse(run('/usr/bin/env', ['ffprobe', '-v', 'error', '-select_streams', type + ':0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', path.join(folder, name)])).packets.map(packet => packet.data_hash);
    const sampleHashes = {};
    for (const original of [originalVideo, originalAudio]) {
      const result = joined.streams.find(stream => stream.codec_type === original.codec_type);
      assert.equal(result.codec_name, original.codec_name);
      assert.equal(result.nb_read_packets, original.nb_read_packets, 'passthrough must preserve every original compressed sample');
      const type = original.codec_type === 'video' ? 'v' : 'a';
      const originalPackets = packets(type === 'v' ? 'video.mp4' : 'audio.m4a', type);
      const joinedPackets = packets('joined.mp4', type);
      assert.deepEqual(joinedPackets, originalPackets, 'passthrough must preserve the bytes of every original compressed packet');
      sampleHashes[original.codec_type] = createHash('sha256').update(JSON.stringify(joinedPackets)).digest('hex');
    }
    if (process.env.LANGFORM_DOWNLOAD_MUX_QA_DIR) {
      const target = path.resolve(process.env.LANGFORM_DOWNLOAD_MUX_QA_DIR);
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(path.join(folder, 'joined.mp4'), path.join(target, 'fixture-joined.mp4'));
      fs.writeFileSync(path.join(target, 'fixture-probe.json'), JSON.stringify({ originalVideo, originalAudio, joined, unchangedSampleHashes: sampleHashes }, null, 2) + '\n');
      fs.writeFileSync(path.join(target, 'native-exercise.log'), output);
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('download mux typechecks with the minimum shipping iPhone target', { skip: process.platform !== 'darwin', timeout: 60000 }, t => {
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' });
  if (sdk.status !== 0) return t.skip('iPhone SDK unavailable');
  run('/usr/bin/xcrun', ['swiftc', '-warnings-as-errors', '-typecheck', '-target', 'arm64-apple-ios17.0', '-sdk', sdk.stdout.trim(), ...native]);
});
