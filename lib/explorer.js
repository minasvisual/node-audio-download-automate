const { lstatSync, readdirSync } = require('fs')
const { join, sep } = require('path')


module.exports = () => {
  
  const isDirectory = source => lstatSync(source).isDirectory()
  const isFile = source => lstatSync(source).isFile()
  const getDirectories = source =>
      readdirSync(source).map(name => join(source, name)).filter(isDirectory)
  const getFiles = source => readdirSync(source).map((name) => join(source, name)).filter(isFile)

  const extractDir = (acc, dir) => {
      if (dir.length === 0) {
          return acc
      }
      if (readdirSync(...dir).length === 0) {
          return acc;
      }
      acc.push(...dir)
      return acc
  }
 

  /**
   * @returns Array
   */
//   exports.getModels = () => getDirectories(`${__dirname}${sep}domains`).map(dir => {
//       return getDirectories(dir).filter(dir => dir.endsWith('models'))
//   }).reduce(extractDir, [])

//   exports.getRoutes = () =>  getDirectories(`${__dirname}${sep}domains`).map(dir => {
//       return getDirectories(dir).filter(dir => dir.endsWith('routes'))
//   }).reduce(extractDir, [])
 
  return {
    isDirectory,
    isFile,
    getDirectories,
    getFiles,
    extractDir
  }
}