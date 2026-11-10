---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-10
scope_description: "Backend upload, private object storage, asynchronous video processing, and byte-range delivery for videos up to 10 GB."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subproject in scope:_ `nestjs-project/`. The frontend is explicitly out of scope.

## TD-01: Upload de arquivos grandes

**Capability:** Upload de vídeos de até 10 GB sem travar a API.

**Options:**

- **A — Multipart direto para storage S3:** a API cria o upload e assina URLs por parte; o cliente transfere cada parte diretamente ao storage.
- **B — Streaming pela API:** a API retransmite o corpo para o storage com backpressure.

**Decision:** A. Upload multipart evita ocupar conexões, memória e banda da API durante transferências grandes e permite retomar partes com falha. O backend reserva o vídeo como rascunho antes da transferência, exige um título e os metadados do arquivo, limita o tamanho a 10.000.000.000 bytes (10 GB), usa partes de 64 MiB e conclui o multipart somente após verificar as partes no storage. A API nunca recebe o arquivo inteiro.

## TD-02: Object storage

**Capability:** Armazenar arquivos originais e thumbnails.

**Options:**

- **A — S3 com MinIO local:** compatibilidade com S3 em desenvolvimento e produção.
- **B — Filesystem local:** instalação simples, mas acoplada ao host e sem compatibilidade com infraestrutura de produção.

**Decision:** A. AWS SDK for JavaScript v3 é usado com URLs internas para chamadas backend e endpoint público configurável para URLs de upload do navegador. MinIO roda em Docker Compose; bucket não público, com credenciais configuráveis. O MinIO habilita CORS por padrão; em produção, a infraestrutura do bucket deve permitir uploads `PUT` da origem do cliente e expor o header `ETag`. A API faz proxy do conteúdo pronto, mantendo os objetos privados.

## TD-03: Fila de processamento

**Capability:** Processamento assíncrono em worker independente.

**Options:**

- **A — BullMQ com Redis:** jobs persistentes, concorrência configurável e retentativas com backoff.
- **B — Fila em tabela PostgreSQL:** sem serviço adicional, mas exige implementar locking, polling, lease e retentativas.

**Decision:** A. BullMQ com Redis dedicado separa o ciclo de vida do worker da API e fornece retries. Jobs usam o ID do vídeo como identificador idempotente; falhas finais são refletidas no estado do vídeo.

## TD-04: Processamento de mídia

**Capability:** Extrair metadados e gerar thumbnail após upload.

**Options:**

- **A — CLI FFprobe/FFmpeg no worker:** executáveis de sistema, processos isolados e baixo consumo de memória em comparação a carregar o vídeo em bibliotecas Node.
- **B — Bibliotecas de binding nativo em Node:** integração direta, mas acrescenta acoplamento a binários e memória no processo da API/worker.

**Decision:** A. O worker baixa o objeto para arquivo temporário, valida a existência de stream de vídeo via FFprobe, extrai duração/dimensões/codecs e gera uma thumbnail com FFmpeg. O arquivo original é preservado; transcodificação não foi solicitada.

## TD-05: Streaming e download

**Capability:** URL única, reprodução sem download completo e download.

**Options:**

- **A — Endpoints da API com HTTP Range:** proxy do objeto privado; suporte a requisições `Range` e resposta `206 Partial Content`.
- **B — Redirecionar para URL pré-assinada:** menor banda na API, mas expõe URLs de storage e requer gerenciar expiração no cliente.

**Decision:** A. O UUID do vídeo compõe a URL estável; a API transmite apenas os bytes solicitados pelo cliente. As rotas públicas só entregam vídeos prontos e diferenciam streaming de download pelo `Content-Disposition`. Esta fase não transcodifica formatos nem implementa HLS/DASH.

## Referências técnicas

- AWS SDK v3: [multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) e [presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
- BullMQ: [workers](https://docs.bullmq.io/guide/workers) e [retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs).
- FFmpeg: [ffprobe](https://ffmpeg.org/ffprobe.html) e [thumbnail extraction](https://ffmpeg.org/ffmpeg-all.html).
- A configuração Docker existente determina o uso do nome de serviço como hostname; ver `nestjs-project/CLAUDE.md`.
