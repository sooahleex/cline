import * as fs from "fs"
import * as path from "path"

const tokenFilePath = path.join(__dirname, "tokenData.json")

export function saveTokenData(inputTokens: number, outputTokens: number, id?: string) {
	let data = []

	// 기존 데이터 읽기
	if (fs.existsSync(tokenFilePath)) {
		const fileContent = fs.readFileSync(tokenFilePath, "utf-8")
		try {
			data = JSON.parse(fileContent)
		} catch (error) {
			console.error("Failed to parse JSON file:", error)
		}
	}

	// 새로운 데이터 추가
	data.push({ id: id, Tokens: { currentInputTokens: inputTokens, currentOutputTokens: outputTokens } })

	// 파일에 저장
	fs.writeFileSync(tokenFilePath, JSON.stringify(data, null, 2), "utf-8")
}

export function loadTokenData() {
	if (fs.existsSync(tokenFilePath)) {
		const data = fs.readFileSync(tokenFilePath, "utf-8")
		try {
			return JSON.parse(data)
		} catch (error) {
			console.error("Failed to parse JSON file:", error)
		}
	}
	return []
}
