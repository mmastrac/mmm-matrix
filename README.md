# mmmm: Matrix Maker for GitHub Actions

`mmm-matrix` is a quick and concise way to build a dynamic GitHub Actions matrix
that can react to different build inputs and events.

## Background: GitHub Actions matrix

A GitHub Actions matrix is a way to run a job or a set of jobs across different
configurations. It's like setting up multiple versions of your workflow to run
simultaneously but with slight variations in settings.

Imagine you have a test suite for your software that you want to run on
different operating systems and with different versions of programming
languages. Instead of creating separate workflows for each combination, you can
define a matrix where each combination becomes a separate job run.

For example, you can specify a matrix with operating systems like Ubuntu, macOS,
and Windows, and another dimension for programming language versions like Python
3.7, 3.8, and 3.9. GitHub Actions will then automatically create individual job
runs for each combination, such as running the tests on Ubuntu with Python 3.7,
on macOS with Python 3.8, and so on.

This approach helps streamline your workflow, making it easier to manage and
ensuring consistent testing across different environments. It's especially
useful for projects that need to support multiple platforms or configurations.

## Why `mmm-matrix`?

`mmm-matrix` solves the problem of efficiently managing and generating complex
matrices for GitHub Actions workflows. Without `mmm-matrix`, creating and
maintaining matrices with various configurations, such as different operating
systems, programming languages, or versions, can be time-consuming and
error-prone. Developers would have to manually write out all the combinations,
leading to potential mistakes and inefficiencies. `mmm-matrix` automates this
process, allowing users to define configurations using simple syntax and rules.
It handles the generation of matrix items, including combinations and
conditions, streamlining the matrix workflow setup.

## Building matrices

`mmm-matrix` builds a matrix by "adding" and "multiplying" configurations.

The matrix is built in three phases:

1. Addition and multiplication: the nested objects, arrays and values are
   combined to produce the candidate list of matrix items. The candidate list
   may contain `$if` or `$dynamic` items that require further evaluation.
2. Evaluation: `$if` or `$dynamic` items are evaluated and the computed item
   list is generated.
3. Merging: any items that are equivalent to a previous item are skipped, while
   any item that is a strict superset of a previous item replaces that previous
   item.

### Addition

Addition happens using JSON or YAML lists. Specify two objects in a list and you
get two matrix configurations:

```yaml
- os: linux
  test: true
- os: mac
  test: false

# Results in:

[{ os: linux, test: true }, { os: mac, test: false }]
```

You can also specify two values in a list to get two matrix configurations:

```yaml
os: [linux, mac]

# Results in:

[{ os: linux }, { os: mac }]
```

Each of the items produced from a list is added to the output list. Note that
while the default mode for lists is addition, you can multiply lists using the
advanced `$array` and `$arrays` keys, described below.

```yaml
# This is almost certainly not what you want
- os: [mac, windows]
- job: [test, clean]

# Results in:

[{ os: mac }, { os: windows }, { job: test }, { job: clean }]

# The correct way to get the product of mac/windows and test/clean is:

$arrays:
  - - os: [mac, windows]
  - - job: [test, clean]

# Results in

[{ os: mac, job: test }, { os: mac, job: clean }, { os: windows, job: test }, ...]
```

### Multiplication

Multiplication is done via
[the Cartesian product](https://en.wikipedia.org/wiki/Cartesian_product) and
happen when using JSON or YAML objects. All of the possible values of an object
are multiplied together:

```yaml
os: [linux, mac, windows]
test: [true, false]

# Results in every combination:

[{ os: linux, test: true }, { os: linux, test: false }, { os: mac, test: true }, ... ]
```

### Nested objects

If you provide a nested object as the value of a key, the top-level key is
paired with the second-level key as a value and multiplied by everything below
that. For example:

```yaml
label:
  label-a:
    os: [a1, a2]
  label-b:
    os: [b1, b2]

# Results in:

[{ label: label-a, os: a1 }, { label: label-a, os: a2 }, { label: label-b, os: b1 }, ... ]
```

### Arbitrary nesting levels

Additions and multiplications can be nested arbitrarily, and the final product
and sum of the entire tree becomes your matrix:

```yaml
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

A configuration object can be provided for every matrix builder. A convenient
value for this is the `github`
[context](https://docs.github.com/en/actions/learn-github-actions/contexts) for
your workflow, which effectively contains the entire input for your workflow.

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

The configuration object is used by the special `$if` and `$dynamic` keys
described below.

## Special object keys

### `$value`

The `$value` key is a special key that allows you to place a nested object where
a value would normally go.

For example, if you want to add `aarch64` and `amd64` support to the `mac` `os`
item, but not the others:

```yaml
os: [linux, windows, mac]

# Becomes

os: [linux, windows, { "$value": "mac", arm: [true, false] }]

# Results in:

[{ os: linux }, { os: windows }, { os: mac, arm: true }, { os: mac, arm: false }]
```

### `$if`

Adding the special `$if` key to an object adds a condition to any matrix item
derived from this part of the tree. If there are multiple `$if` conditions that
apply to a single matrix item, the matrix item is only included if all `$if`
conditions evaluate to true.

When the `$if` condition of the matrix item is evaluated, it has access to a
JavaScript `this` object which refers to the currently evaluated item, and a
`config` object which refers to the `config` input to the action.

```yaml
label:
  linux:
    - $if: "this.distro == config.distro"
    - distro: [ubuntu, arch, slackware, redhat]

# Results in (with `config = { distro: ubuntu }`):

[{ label: linux, distro: ubuntu }]
```

### `$match`

Adding the special `$match` key to an object creates a switch-like statement
that evaluates each of its keys and returns the first matching branch:

```yaml
$match:
  "config.os == 'linux'":
    jobs: [a, b, c]
  "config.os == 'mac'":
    jobs: [a]
```

A default may be specified like so (or alternatively, by providing a `true`
condition to `$match`):

```yaml
jobs: [a, b]
$match:
  "config.os == 'linux'":
    jobs: [a, b, c]
  "config.os == 'mac'":
    jobs: [a]
```

`match` may also be specified in a value context:

```yaml
job:
  $match:
    "config.os == 'linux'": [a, b, c]
    "config.os == 'mac'": [a]
```

### `$dynamic`

Adding the special `$dynamic` key to an object adds a value that is evaluated
only once the entire matrix has been built. This can be used to set the value of
one output key to some function of the input configuration and/or other keys in
that particular item.

When the `$dynamic` condition of the matrix item is evaluated, it has access to
a JavaScript `this` object which refers to the currently evaluated item, and a
`config` object which refers to the `config` input to the action.

```yaml
os: { "$dynamic": "this.distro + '-latest'" }
distro: [ubuntu, arch]

# Results in:

[{ os: "ubuntu-latest", distro: ubuntu }, { os: "arch-latest", distro: arch }]
```

### `$array` and `$arrays`

While lists are normally added together, you can also multiply them using the
special `$array` key. If you specify an `$array` key as part of an object, the
items generated by each item of the array are multiplied by the other items
generated by that object.

```yaml
$array:
  - os: linux
    debug: true
  - os: mac
    debug: false
job: run

# Results in:

[ { os: linux, debug: true, job: run }, { os: mac, debug: false, job: run } ]
```

As you can only specify `$array` as a key once in an object, if you wish to
multiply more complex sets of arrays, you can use `$arrays` instead. The value
of `$arrays` is either an array, or an object with numeric keys. You may prefer
the latter format as nested arrays tend to be awkward in YAML.

```yaml
$arrays:
  0:
    - with-config: a
      mode: debug
    - with-config: b
      mode: release
  1:
    - os: linux
      job: job-a
    - os: mac
      job: job-b

# or

$arrays:
  - - with-config: a
      mode: debug
    - with-config: b
      mode: release
  - - os: linux
      job: job-a
    - os: mac
      job: job-b

# Results in:

[{ with-config: a, mode: debug, os: linux, job: job-a }, { with-config: b, mode: release, os: linux, job: job-a }, ...]
```

## Merging

Any items that are equivalent to a previous item are skipped, while any item
that is a strict superset of a previous item replaces that previous item.

For example, an item that has one extra key than another will mask the former:

```yaml
- os: linux
- os: linux
  debug: true

# Results in:

[{ os: linux, debug: true }]
```

## Action Configuration

The `mmm-matrix` action is designed to be an input for a job with
`strategy: matrix`.

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
        include: ${{ fromJSON(needs.generate.outputs.matrix) }}
    steps:
      - name: Print matrix
        run: "echo '${{ toJSON(matrix) }}'"
```
