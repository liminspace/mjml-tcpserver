FROM node:14-bullseye

ARG MJML_VERSION=4.14.1
ARG EXPOSE=28101

ENV WORKDIR /app
ENV SCRIPTSDIR /scripts
ENV PATH "$SCRIPTSDIR:${PATH}"
ENV HOST="0.0.0.0"
ENV PORT=$EXPOSE

COPY entrypoint.sh $SCRIPTSDIR/
RUN chmod +x $SCRIPTSDIR/*.sh


RUN set -ex; \
    npm init -y; \
    npm install mjml@${MJML_VERSION}

COPY tcpserver.js $WORKDIR/

WORKDIR $WORKDIR

EXPOSE $EXPOSE

ENTRYPOINT ["entrypoint.sh"]

CMD ["--mjml.minify=true", "--mjml.validationLevel=strict"]
