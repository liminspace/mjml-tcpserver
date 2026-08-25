FROM node:24-trixie

ARG MJML_VERSION=5.4.0
ARG EXPOSE=28101

ENV WORKDIR=/app
ENV SCRIPTSDIR=/scripts
ENV PATH="$SCRIPTSDIR:${PATH}"
ENV HOST="0.0.0.0"
ENV PORT=$EXPOSE

COPY entrypoint.sh $SCRIPTSDIR/
RUN chmod +x $SCRIPTSDIR/*.sh

WORKDIR $WORKDIR

RUN set -ex; \
    npm init -y; \
    npm install mjml@${MJML_VERSION}

COPY tcpserver.js $WORKDIR/

EXPOSE $EXPOSE

ENTRYPOINT ["entrypoint.sh"]

CMD ["--mjml.minify=true", "--mjml.validationLevel=strict"]
