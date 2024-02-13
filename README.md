# mmmm: Matrix Maker for GitHub Actions

## Action Configuration

The `mmmm` action is designed to be an input for a job with `strategy: matrix`.

```yaml
jobs:
  generate:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.generate.outputs.matrix }}
    steps:
      - id: generate
        uses: "mmastrac/mmmm@v1"
        with:
          input: |
            label:
              linux:
                os: ubuntu-latest
                job: [job-a, job-b, { "$value": "job-c", "$if": "config.github.actor != 'mmastrac'" }]
                user: { "$dynamic": "config.github.actor" }
              macos:
                os: macOS-latest
                job: [job-c]
              windows:
                os: windows-2019
                job: [job-a]
          config: |
            github: ${{ toJSON(github) }}

  matrix:
    name: ${{ matrix.label }} / ${{ matrix.job }}
    needs: generate
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include: ${{ fromJSON(generate.dist.outputs.matrix) }}
    steps:
      - name: Print matrix
        run: "echo '${{ toJSON(matrix) }}'"
```
