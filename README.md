# mmmm: Matrix Maker for GitHub Actions

## Building Matrices

`mmm-matrix` builds a matrix by "adding" and "multiplying" configurations.

### Addition

Addition happens using JSON or YAML lists. Specify two objects in a list and you get two matrix configurations:

```
- os: linux
  test: true
- os: mac
  test: false

# Results in:

[{ os: linux, test: true }, { os: mac, test: false }]
```

### Multiplication

Multiplication is done via [the Cartesian product](https://en.wikipedia.org/wiki/Cartesian_product) and happen when using JSON or YAML objects. All of the possible values of an object are multiplied together:

```
os: [linux, mac, windows]
test: [true, false]

# Results in every combination:

[{ os: linux, test: true }, { os: linux, test: false }, { os: mac, test: true }, ... ]

```

### Nested object

If you provide a nested object as the value of a key, the top-level key is paired with the second-level key as a value and multiplied by everything below that. For example:

```
label:
  label-a:
    os: [a1, a2]
  label-b:
    os: [b1, b2]

# Results in:

[{ label: label-a, os: a1 }, { label: label-a, os: a2 }, { label: label-b, os: b1 }, ... ]
```

### Arbitrary nesting levels

Additions and multiplications can be nested arbitrarily, and the final product and sum of the entire tree becomes your matrix:

```
label:
  linux:
    os: { "$dynamic": "`${this.distro}-latest`" }
    job: [job-a, job-b, job-c]
    distro: [ubuntu, arch]
  macos:
    os: macOS-latest
    job: [job-c]
  windows:
    os: windows-2019
    job: [job-a]

# Results in:

[{ label: linux, os: ubuntu-latest, job: job-a, distro: ubuntu }, ...]

```

## Configuration

A configuration object can be provided for every matrix builder. A convenient value for this is the `github` [context](https://docs.github.com/en/actions/learn-github-actions/contexts) for your workflow, which effectively contains the entire input for your workflow.

```yaml
  config: |
    github: ${{ toJSON(github) }}
```

You can also provide computed keys:

```yaml
  config: |
    github: ${{ toJSON(github) }}
    isMainBranch: ${{ github.ref == 'refs/heads/main' }}
    isOwner: ${{ github.actor == github.repository_owner }}
```

The configuration object is used by the special `$if` and `$dynamic` keys described below.

## Special object keys 

### `$value`

The `$value` key is a special key that allows you to place a nested object where a value would normally go.

For example, if you want to add `aarch64` and `amd64` support to the `mac` `os` item, but not the others:

```yaml
os: [linux, windows, mac]

# Becomes

os: [linux, windows, { "$value": "mac", arm: [true, false] }

# Results in:

[{ os: linux }, { os: windows }, { os: mac, arm: true }, { os: mac, arm: false }]
```

### `$if`

Adding the special `$if` key to an object adds a condition to any matrix item derived from this part of the tree. If there are multiple `$if` conditions that apply to a single matrix item, the matrix item is only included if all `$if` conditions evaluate to true.

When the `$if` condition of the matrix item is evaluated, it has access to a JavaScript `this` object which refers to the currently evaluated item, and a `config` object which refers to the `config` input to the action.

```
label:
  linux:
    - $if: "this.distro == config.distro"
    - distro: [ubuntu, arch, slackware, redhat]

# Results in (with `config = { distro: ubuntu }`):

[{ label: linux, distro: ubuntu }]
```

### `$dynamic`

Adding the special `$dynamic` key to an object adds a value that is evaluated only once the entire matrix has been built. This can be used to set the value of one output key to some function of the input configuration and/or other keys in that particular item.

When the `$dynamic` condition of the matrix item is evaluated, it has access to a JavaScript `this` object which refers to the currently evaluated item, and a `config` object which refers to the `config` input to the action.

```
os: { "$dynamic": "this.distro + '-latest'" }
distro: [ubuntu, arch]

# Results in:

[{ os: "ubuntu-latest", distro: ubuntu }, { os: "arch-latest", distro: arch }]
```

## Action Configuration

The `mmm-matrix` action is designed to be an input for a job with `strategy: matrix`.

```yaml
jobs:
  generate:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.generate.outputs.matrix }}
    steps:
      - id: generate
        uses: "mmastrac/mmm-matrix@v1"
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
