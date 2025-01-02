require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const app = express();
const PORT = process.env.PORT || 3000;
const NodeID3tag = require("node-id3tag");
const fs = require("fs").promises;
const targetPath = process.env.TARGET || "./music/";
const baseUrl = process.env.BASEURL || "";

let job = {};
app.set("view engine", "ejs");
app.use(baseUrl, express.static("public"));

app.get(baseUrl + "/", (req, res) => {
  res.render("index");
});

app.get(baseUrl + "/search", async (req, res) => {
  const { query } = req.query;
  const url = `https://ncs.io/music-search?q=${query}&genre=&mood=`;

  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const results = [];

    $("table.tablesorter tbody tr").each((_, element) => {
      const trackUrl = $(element).find(".player-play").data("url");
      const artist = $(element).find(".player-play").data("artistraw");
      const title = $(element).find(".player-play").data("track");
      const cover = $(element).find(".player-play").data("cover");
      const tid = $(element).find(".player-play").data("tid");
      const versions = $(element).find(".player-play").data("versions");
      const genre = $(element).find(".player-play").data("genre");
      const date = $(element).find("td[5]").text();
      const data = {
        trackUrl,
        artist,
        title,
        cover,
        genre,
        tid,
        date,
        versions: versions.split(", "),
        status: "Not Downloaded",
      };
      if (!job[tid]) job[tid] = data;
      results.push(data);
    });

    res.render("results", { results, query });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching data.");
  }
});
app.get(baseUrl + "/status/:tid", async (req, res) => {
  try {
    res.send(job[req.params.tid]["status"]);
  } catch (error) {
    res.status(500).send("No Data");
  }
});
app.get(baseUrl + "/download/:tid", async (req, res) => {
  let data = job[req.params.tid.replace("i_", "")];
  if (!data) return res.send("Please reload the page");
  if (job[req.params.tid] && job[req.params.tid].status == "Downloading")
    return res.send("Already Downloading");
  res.send("Downloading");
  job[req.params.tid] = data;
  job[req.params.tid].status = "Downloading";
  const { tid } = req.params;

  try {
    let response = await axios.get(
      `https://ncs.io/track/info/${req.params.tid.replace("i_", "")}`
    );
    const $ = cheerio.load(response.data);
    // get background image url from .img
    console.log("Downloading: " + data.title);
    let imageUrl = $(".img").css("background-image");
    // remove url() and quotes
    // replace /artwork-440x440.jpg or any other resolution with /artwork.jpg
    imageUrl = imageUrl
      .replace("url(", "")
      .replace(")", "")
      .replace(/['"]+/g, "")
      .replace(/-[\d]{1,4}x[\d]{1,4}/, "");
    // 並行下載圖片和音樂檔案
    const [imageResponse, musicResponse] = await Promise.all([
      axios.get(imageUrl, { responseType: "arraybuffer" }),
      axios.get("https://ncs.io/track/download/" + tid, {
        responseType: "arraybuffer",
        onDownloadProgress: (progressEvent) => {
          const percentage = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          job[req.params.tid].status = `Downloading: ${percentage}%`;
        },
      }),
    ]);

    const image = Buffer.from(imageResponse.data);
    const fileData = Buffer.from(musicResponse.data);
    const filePath =
      targetPath +
      data.artist +
      " - " +
      data.title +
      (req.params.tid.includes("i_") ? " (Instrumental)" : "") +
      ".mp3";

    // 寫入檔案
    await fs.writeFile(filePath, fileData);
    console.log("Processing: " + data.title);
    let success = NodeID3tag.write(
      {
        title: data.title,
        artist: data.artist,
        publisher: "NoCopyrightSounds",
        genre: data.genre,
        date: data.date,
        copyright: "NCS",
        image: {
          mime: "image/jpeg",
          type: {
            id: 3,
            name: "front cover",
          },
          description: "front cover",
          imageBuffer: image,
        },
      },
      filePath
    );
    console.log(success);
    if (success) {
      job[req.params.tid].status = "Downloaded";
    } else {
      job[req.params.tid].status = "Failed";
      console.error("Failed to write tags");
    }
  } catch (error) {
    console.error(error);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
