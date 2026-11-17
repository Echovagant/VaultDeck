#!/usr/bin/env node
// 生成 VaultDeck 本地 CA、服务端证书与可选的客户端证书（双向 TLS）。
// 仅使用通用名称与 localhost/127.0.0.1，不写入机器名、用户名或个人路径。
// 用法（仓库内）：
//   node deploy/windows/gen-certs.mjs --out certs
//   node deploy/windows/gen-certs.mjs --out certs --server-san vaultdeck.local --server-ip <LAN_IP>
//   node deploy/windows/gen-certs.mjs --out certs --client-name phone
// 发布包内：node tools/setup/gen-certs.mjs --out certs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import forge from 'node-forge';

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outDir = path.resolve(argValue('--out', 'certs'));
const serverCn = argValue('--server-cn', 'vaultdeck.local');
const days = Number(argValue('--days', '3650'));
const force = process.argv.includes('--force');
const clientOnly = process.argv.includes('--client-only');
const clientName = argValue('--client-name', '');
const extraDns = argValue('--server-san', '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const extraIps = argValue('--server-ip', '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

if (!Number.isFinite(days) || days < 1) throw new Error('--days 必须是正整数');
if (clientName && !/^[A-Za-z0-9._-]{1,64}$/.test(clientName)) {
  throw new Error('--client-name 只允许字母、数字、点、下划线与连字符');
}

mkdirSync(outDir, { recursive: true });

function ensureWritable(file) {
  if (existsSync(file) && !force) {
    throw new Error(`文件已存在：${file}（使用 --force 覆盖）`);
  }
}

function serialNumber() {
  return randomBytes(16).toString('hex');
}

function validity() {
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + days * 24 * 60 * 60 * 1000);
  notBefore.setMinutes(notBefore.getMinutes() - 5);
  return { notBefore, notAfter };
}

function createCa(commonName, pathLength = 0) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serialNumber();
  const { notBefore, notAfter } = validity();
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const subject = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'VaultDeck Local' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: pathLength },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, keys };
}

function createLeaf({ commonName, ca, client, dnsNames, ipAddresses }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serialNumber();
  const { notBefore, notAfter } = validity();
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  cert.setSubject([
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'VaultDeck Local' },
  ]);
  cert.setIssuer(ca.cert.subject.attributes);

  const altNames = [
    ...dnsNames.map((value) => ({ type: 2, value })),
    ...ipAddresses.map((ip) => ({ type: 7, ip })),
  ];
  const extensions = [
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: !client,
      clientAuth: client,
    },
    { name: 'subjectKeyIdentifier' },
  ];
  if (altNames.length > 0) extensions.push({ name: 'subjectAltName', altNames });
  cert.setExtensions(extensions);
  cert.sign(ca.keys.privateKey, forge.md.sha256.create());
  return { cert, keys };
}

function writePair(baseName, pair) {
  const certFile = path.join(outDir, `${baseName}.crt`);
  const keyFile = path.join(outDir, `${baseName}.key`);
  ensureWritable(certFile);
  ensureWritable(keyFile);
  writeFileSync(certFile, forge.pki.certificateToPem(pair.cert), 'utf8');
  writeFileSync(keyFile, forge.pki.privateKeyToPem(pair.keys.privateKey), 'utf8');
  return { certFile, keyFile };
}

const ca = clientOnly ? null : createCa('VaultDeck Local CA');
const caFiles = ca ? writePair('ca', ca) : null;

const dnsNames = [...new Set(['localhost', ...(serverCn ? [serverCn] : []), ...extraDns])];
const ipAddresses = [...new Set(['127.0.0.1', ...extraIps])];
const server = ca
  ? createLeaf({
      commonName: serverCn,
      ca,
      client: false,
      dnsNames,
      ipAddresses,
    })
  : null;
const serverFiles = server ? writePair('server', server) : null;

const result = {};
if (caFiles && serverFiles) {
  result.ca = caFiles.certFile;
  result.serverCert = serverFiles.certFile;
  result.serverKey = serverFiles.keyFile;
  result.serverDns = dnsNames;
  result.serverIps = ipAddresses;
}

if (clientName) {
  const clientCa = createCa('VaultDeck Client CA');
  const clientCaFiles = writePair('client-ca', clientCa);
  const client = createLeaf({
    commonName: clientName,
    ca: clientCa,
    client: true,
    dnsNames: [],
    ipAddresses: [],
  });
  const clientFiles = writePair(`client-${clientName}`, client);
  result.clientCa = clientCaFiles.certFile;
  result.clientCert = clientFiles.certFile;
  result.clientKey = clientFiles.keyFile;
  result.clientName = clientName;
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
