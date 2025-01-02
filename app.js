require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const app = express();
const PORT = process.env.PORT || 3000;
const NodeID3tag = require("node-id3tag");
const fs = require("fs").promises;
const targetPath = process.env.TARGET || "./music/";

let job = {};
app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/search", async (req, res) => {
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

    res.render("results", { results });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching data.");
  }
});
app.get("/status/:tid", async (req, res) => {
  try {
    res.send(job[req.params.tid]["status"]);
  } catch (error) {
    res.status(500).send("No Data");
  }
});
app.get("/download/:tid", async (req, res) => {
  if (!job[req.params.tid]) return res.send("Please reload the page");
  let status = job[req.params.tid].status;
  if (status == "Downloading") {
    return res.send("Already Downloading");
  }
  res.send("Downloading");
  let data = job[req.params.tid.replace("i_", "")];
  job[req.params.tid].status = "Downloading";
  const { tid } = req.params;

  try {
    let response = await axios.get(`https://ncs.io/track/info/${tid}`);
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
    response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const image = Buffer.from(response.data);
    const downloadLink = "https://ncs.io/track/download/" + tid;
    console.log(downloadLink);
    response = await axios.get(downloadLink, { responseType: "arraybuffer" });
    const fileData = Buffer.from(response.data);
    const filePath = targetPath + data.artist + " - " + data.title + ".mp3";
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
