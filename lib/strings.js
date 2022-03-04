const path = require('path')
const fs = require('fs')

module.exports = (app) => { 
	const clearname = function(file){
		file = file.replace(/[áàãâä]/g, 'a');
		file = file.replace(/[éèêë]/g, 'e');
		file = file.replace(/[íìîï]/g, 'i');
		file = file.replace(/[óòõôö]/g, 'o');
		file = file.replace(/[úùûü]/g, 'u');
		file = file.replace(/[ÁÀÃÂ]/g, 'a');
		file = file.replace(/[éèêë]/g, 'e');
		file = file.replace(/[íìîï]/g, 'i');
		file = file.replace(/[óòõôö]/g, 'o');
		file = file.replace(/[úùûü]/g, 'u');
		file = file.replace(/[ç]/g, 'c');
		file = file.replace(/[&]/g, 'and');
		file = file.replace(/[^a-zA-Z0-9-.]/g, ' ');
		file = file.replace(/_+/, '_');
		return file;
	}

	const replaceDiacritics = function(str){

		var diacritics = [
			{char: 'A', base: /[\300-\306]/g},
			{char: 'a', base: /[\340-\346]/g},
			{char: 'E', base: /[\310-\313]/g},
			{char: 'e', base: /[\350-\353]/g},
			{char: 'I', base: /[\314-\317]/g},
			{char: 'i', base: /[\354-\357]/g},
			{char: 'O', base: /[\322-\330]/g},
			{char: 'o', base: /[\362-\370]/g},
			{char: 'U', base: /[\331-\334]/g},
			{char: 'u', base: /[\371-\374]/g},
			{char: 'N', base: /[\321]/g},
			{char: 'n', base: /[\361]/g},
			{char: 'C', base: /[\307]/g},
			{char: 'c', base: /[\347]/g},
			{char: 'and', base: /[\046]/g}
		]

		diacritics.forEach(function(letter){
			str = str.replace(letter.base, letter.char);
		});

		str = str.replace(/[^a-zA-Z0-9-.]/g, ' ');
		str = str.replace(/_+/, '_');

		return str;
	};

	const sanitizeFile = async ({ filePath }) => new Promise((res, rej) => { 
		let filename = path.basename(filePath)
		let newfilename = replaceDiacritics(filename)
		let folderPath = path.dirname(filePath)
		fs.rename( filePath, path.resolve(folderPath, newfilename) , (err) =>{
			if(err) rej(err)
			else res({ filename: newfilename, filePath: path.resolve(folderPath, newfilename)})
		} )
	})

	return {
		clearname,
		replaceDiacritics,
		sanitizeFile
	}
}