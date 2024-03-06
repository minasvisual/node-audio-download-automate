FROM node:14

WORKDIR /usr/src/app

ENV PORT 8080
ENV HOST 0.0.0.0

RUN apt-get -y update
RUN apt-get install -y ffmpeg
RUN apt-get install -y lame

COPY . .

RUN npm install
RUN node app.js installation
# RUN node downloader getYoutubeByApi

CMD node index.js