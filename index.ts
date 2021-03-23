import axios from 'axios'
import { EventEmitter } from 'events'
import fs from 'fs'
import fsP from 'fs/promises'
import rimraf from 'rimraf'
import ora from 'ora'
import ytdl from 'ytdl-core'
import ffmpeg from 'fluent-ffmpeg'
import PromisePool from 'es6-promise-pool'
import { spawn,exec } from 'child-process-promise'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { join } from 'path'
import { Promise as NodeID3, Tags } from 'node-id3'
import { ImageInfo, ImageNodeContainer, ImageNodeContainerValueNode, ImagePropertyNode, ImageSoundNode, WzFile, WzImage } from 'wz-parser'

// Constants
const WZ_DIR_PATH = join(__dirname, './wz')
const DIST_DIR_PATH = join(__dirname, './dist')
const BUILD_DATA_PATH = join(DIST_DIR_PATH, 'build.json')
const DOWNLOAD_CONCURRENCY: number = 20

// Types
interface BuildData {
  waitingIds: string[];
  downloadingIds: string[];
  doneIds: string[];
}

interface SaveBgmFilesFunctionParams {
  bgmDatas: MapleBgmData[];
  buildData?: BuildData;
  onProgress?: (waitingIds: string[], downloadingIds: string[], doneIds: string[]) => void;
}

interface MapleBgmData {
  description: string;
  filename: string;
  mark: string;
  metadata: Metadata;
  source: Source;
  youtube: string;
}

interface Metadata {
  albumArtist: AlbumArtist;
  artist: Artist;
  title: string;
  year: string;
  titleAlt?: string;
}

enum AlbumArtist {
  Necord = "NECORD",
  Wizet = "Wizet",
}

enum Artist {
  Asteria = "ASTERIA",
  ChataXOsterProject = "Chata x Oster Project",
  Codasound = "CODASOUND",
  DJSearcher = "DJ Searcher",
  Euphonius = "Euphonius",
  HarukaShimotsuki = "Haruka Shimotsuki",
  IdinaMenzel = "Idina Menzel",
  Jimang = "Jimang",
  MikuniShimokawa = "Mikuni Shimokawa",
  RenLongxin = "Ren Longxin",
  StudioEIM = "StudioEIM",
  TakkyuIshino = "Takkyu Ishino",
  TakkyuIshinoWizet = "Takkyu Ishino\u0000Wizet",
  Wizet = "Wizet",
  さつきがてんこもりFeat初音ミク = "さつき が てんこもり feat. 初音ミク",
  まふまふFeat初音ミク = "まふまふ feat. 初音ミク",
}

interface Source {
  client?: Client;
  date?: Date;
  structure: string;
  version?: string;
}

enum Client {
  Bms = "BMS",
  CMS = "CMS",
  Cmst = "CMST",
  Gms = "GMS",
  JMS = "JMS",
  Kms = "KMS",
  Kmst = "KMST",
  Msea = "MSEA",
  ThMS = "ThMS",
  Tms = "TMS",
  Tmst = "TMST",
}

// Functions
async function exists(p: string) {
  try {
    await fsP.access(p)
    return true
  } catch(e) {
    return false
  }
}

function mkdir(p: string) {
  return fsP.mkdir(p, { recursive: true })
}

function rm(p: string) {
  return new Promise<void>((resolve, reject) => {
    rimraf(p, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function downloadYoutubeMp3(url: string, path: string, tags?: Tags) {
  await new Promise((resolve, reject) => {
    const stream = ytdl(url, {
      quality: 'highestaudio'
    })
    ffmpeg({ source: stream })
      .setFfmpegPath(ffmpegPath)
      .on('error', reject)
      .on('end', resolve)
      .save(path)
  })
  if (tags) await NodeID3.write(tags, path)
}

async function saveBgmFiles({ bgmDatas, buildData, onProgress }: SaveBgmFilesFunctionParams) {
  const emitter = new EventEmitter()
  emitter.on('progress', onProgress ?? (() => { }))
  bgmDatas = bgmDatas.filter((d) => !!d.youtube)
  function getId(d: MapleBgmData) { return `${d.source.structure}/${d.filename}` }
  const waitingIds: string[] = buildData
    ? bgmDatas.map(getId).filter(id => !buildData.doneIds.includes(id))
    : bgmDatas.map(getId)
  const downloadingIds: string[] = []
  const doneIds: string[] = buildData
    ? [...buildData.doneIds]
    : []
  const indexedBgmData: Record<string, MapleBgmData> = Object.fromEntries(
    bgmDatas.map(d => [getId(d), d])
  )
  function registerExitHandler() {
    let flag = false;
    ['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM']
      .forEach((eventType) => {
        process.on(eventType, async () => {
          if (flag) return
          const data = {
            waitingIds,
            downloadingIds,
            doneIds
          }
          fs.writeFileSync(
            BUILD_DATA_PATH,
            JSON.stringify(
              data,
              null,
              2
            )
          )
          flag = true
          process.exit()
        })
      })
  }
  function emitOnProgress() {
    emitter.emit('progress', waitingIds, downloadingIds, doneIds)
  }
  function start(id: string) {
    downloadingIds.push(...waitingIds.splice(waitingIds.indexOf(id), 1))
    emitOnProgress()
  }
  function finish(id: string) {
    doneIds.push(...downloadingIds.splice(waitingIds.indexOf(id), 1))
    emitOnProgress()
  }
  registerExitHandler()
  async function getWzInfos(fileName: string) {
    try {
      return (await (new WzFile(join(WZ_DIR_PATH, fileName))).parse()).value!.dir!.filter(i => i.name.startsWith('Bgm')) as ImageInfo[]
    } catch (error) {
      return []
    }
  }
  const bgmImages: [string, ImageNodeContainer][] = [
    ...(await getWzInfos('Sound.wz')),
    ...(await getWzInfos('Sound2.wz'))
  ].map(info => [info.name.replace('.img', ''), (new WzImage(info)).parse().value!])
  for (const [folderName, image] of bgmImages) {
    const folderDir = join(DIST_DIR_PATH, folderName)
    const soundImageNodes: [string, ImageNodeContainer][] = (((await image.extractImg()).value! as ImagePropertyNode).children as ImageNodeContainerValueNode[])
      .map(vn => [vn.name, vn.value])
    for (const [soundName, soundImage] of soundImageNodes) {
      const id = `${folderName}/${soundName}`
      if (!waitingIds.includes(id) || downloadingIds.includes(id) || doneIds.includes(id)) continue
      const data = indexedBgmData[id]
      if (!data) continue
      let buffer = await ((await soundImage.extractImg()).value! as ImageSoundNode).value.extractSound?.()
      if (!buffer) continue
      start(id)
      await mkdir(folderDir)
      buffer = await NodeID3.write({
        artist: data.metadata.artist,
        title: data.metadata.title,
        year: data.metadata.year
      }, buffer)
      await fsP.writeFile(join(folderDir, `${soundName}.mp3`), buffer)
      finish(id)
    }
  }
  const downloadExecutors: [string, (() => Promise<void>)][] = waitingIds
    .map((id) => {
      const bgmData = indexedBgmData[id]!
      return [
        id,
        async () => {
          start(id)
          const url = `https://youtu.be/${bgmData.youtube}`
          const folderPath = join(DIST_DIR_PATH, bgmData.source.structure)
          const outputPath = join(folderPath, `${bgmData.filename}.mp3`)
          await mkdir(folderPath)
          await downloadYoutubeMp3(url, outputPath, {
            artist: bgmData.metadata.artist,
            title: bgmData.metadata.title,
            year: bgmData.metadata.year
          })
          finish(id)
        }
      ]
    })
  const promiseProducer = () => {
    const executor = downloadExecutors.shift()
    if (!executor) return
    return executor[1]()
  }
  const promisePool = new PromisePool(promiseProducer, DOWNLOAD_CONCURRENCY)
  await promisePool.start()
}

// Run
(async () => {
  let buildData: BuildData | undefined = undefined
  try {
    buildData = require(BUILD_DATA_PATH)
  } catch (e) {
    await rm(DIST_DIR_PATH)
    await exec('git clone -b gh-pages --filter=blob:none --no-checkout https://github.com/maple-pod/bgm.git dist && cd dist && git reset HEAD && git checkout build.json .gitignore')
    buildData = require(BUILD_DATA_PATH)
    await exec(`cd dist && git update-index --assume-unchanged ${buildData!.doneIds.map(id => `"${id}.mp3"`).join(' ')}`)
  }
  const spinner = ora('Start to build BGM repo...').start()
  const { data }: { data: MapleBgmData[] } = await axios.get('https://raw.githubusercontent.com/maplestory-music/maplebgm-db/prod/bgm.min.json')
  const onProgress: (waitingIds: string[], downloadingIds: string[], doneIds: string[]) => void =
    (w, dl, d) => spinner.text = `${Math.floor((1 - (w.length + dl.length) / (w.length + dl.length + d.length)) * 100)}% (Waiting: ${w.length}, Downloading: ${dl.length}, Done: ${d.length})`
  await saveBgmFiles({
    bgmDatas: data,
    buildData,
    onProgress
  })
  spinner.succeed('Finish building BGM repo! Ready to deploy!')
})()