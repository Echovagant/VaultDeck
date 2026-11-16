export class StorageUnavailable extends Error {
  constructor(message = '存储不可用') {
    super(message);
    this.name = 'StorageUnavailable';
  }
}

export class ChecksumMismatch extends Error {
  constructor(message = '校验值不一致') {
    super(message);
    this.name = 'ChecksumMismatch';
  }
}

export class PreviewUnavailable extends Error {
  constructor(message = '预览能力不可用') {
    super(message);
    this.name = 'PreviewUnavailable';
  }
}

export class AuthFailed extends Error {
  constructor(message = '认证失败') {
    super(message);
    this.name = 'AuthFailed';
  }
}
