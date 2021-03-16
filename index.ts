import axios from 'axios'
import fs from 'fs/promises'
import rimraf from 'rimraf'
import ora from 'ora'
import { join } from 'path'
import { Promise as NodeID3 } from 'node-id3'
import { ImageInfo, ImageNodeContainer, ImageNodeContainerValueNode, ImagePropertyNode, ImageSoundNode, WzFile, WzImage } from 'wz-parser'

// Constants
const WZ_DIR_PATH = join(__dirname, './wz')
const DIST_DIR_PATH = join (__dirname, './dist')

// Types
interface MapleBgmData {
  description: string;
  filename:    string;
  mark:        string;
  metadata:    Metadata;
  source:      Source;
  youtube:     string;
}

interface Metadata {
  albumArtist: AlbumArtist;
  artist:      Artist;
  title:       string;
  year:        string;
  titleAlt?:   string;
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
  client?:   Client;
  date?:     Date;
  structure: string;
  version?:  string;
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
function mkdir(p: string) {
  return fs.mkdir(p, { recursive: true })
}

function rm(p: string) {
  return new Promise<void>((resolve, reject) => {
    rimraf(p, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function saveBgmFiles(bgmData: MapleBgmData[]) {
  const bgmList: string[] = []
  const indexedBgmData: Record<string, MapleBgmData> = Object.fromEntries(
    bgmData.map(d => [`${d.source.structure}/${d.filename}`, d])
  )
  async function getInfos(fileName: string) {
    return (await (new WzFile(join(WZ_DIR_PATH, fileName))).parse()).value!.dir!.filter(i => i.name.startsWith('Bgm')) as ImageInfo[]
  }
  const bgmImages: [string, ImageNodeContainer][] = [
    ...(await getInfos('Sound.wz')),
    ...(await getInfos('Sound2.wz'))
  ].map(info => [info.name.replace('.img', ''), (new WzImage(info)).parse().value!])
  for (const [folderName, image] of bgmImages) {
    const folderDir = join(DIST_DIR_PATH, folderName)
    const soundImageNodes: [string, ImageNodeContainer][] = (((await image.extractImg()).value! as ImagePropertyNode).children as ImageNodeContainerValueNode[])
      .map(vn => [vn.name, vn.value])
    for (const [soundName, soundImage] of soundImageNodes) {
      let buffer = await ((await soundImage.extractImg()).value! as ImageSoundNode).value.extractSound?.()
      if (!buffer) continue
      const key = `${folderName}/${soundName}`
      const data = indexedBgmData[key]
      bgmList.push(key)
      await mkdir(folderDir)
      if (data) {
        buffer = await NodeID3.write({
          artist: data.metadata.artist,
          title: data.metadata.title,
          year: data.metadata.year
        }, buffer)
      }
      await fs.writeFile(join(folderDir, `${soundName}.mp3`), buffer)
    }
  }
  await fs.writeFile(
    join(DIST_DIR_PATH, 'list.json'),
    JSON.stringify(
      bgmList,
      null,
      2
    )
  )
}

// Run
(async () => {
  const spinner = ora('Start to build BGM repo...').start()
  await rm(DIST_DIR_PATH)
  await mkdir(DIST_DIR_PATH)
  const { data }: { data: MapleBgmData[] } = await axios.get('https://raw.githubusercontent.com/maplestory-music/maplebgm-db/prod/bgm.min.json')
  await saveBgmFiles(data)
  spinner.succeed('Finish building BGM repo! Ready to deploy!')
})()